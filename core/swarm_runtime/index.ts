import os from "node:os";
import path from "node:path";

import { buildRepoSummary } from "../../agents/ai-support";
import { writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectContext, SwarmPlanTask, SwarmRunResult, SwarmWorkerResult } from "../../shared/types";
import type { AIRouterRequest, AIRouterTask, ModelProfile, ModelSelection } from "../ai_router/router";

interface SwarmAssistant {
  ask(input: AIRouterRequest): Promise<string>;
  selectModel(input: AIRouterRequest): Promise<ModelSelection>;
}

interface SwarmRuntimeOptions {
  parallelism?: number;
  chunkSize?: number;
  taskTimeoutMs?: number;
  maxRetries?: number;
  plannerTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  runTimeoutMs?: number;
  maxQueuedTasks?: number;
  scopeBias?: SwarmRunResult["chunking"]["scopeBias"];
}

interface PlannerPayload {
  overview: string;
  tasks: SwarmPlanTask[];
}

interface WorkerPayload {
  summary: string;
  findings: string[];
  recommendations: string[];
}

interface SynthesisPayload {
  headline: string;
  summary: string;
  priorities: string[];
  next_steps: string[];
}

interface ScopeChunk {
  chunkId: string;
  label: string;
  scopePaths: string[];
}

interface QueuedSwarmTask {
  taskId: string;
  parentTaskId: string;
  title: string;
  goal: string;
  profile: SwarmPlanTask["profile"];
  deliverable: string;
  chunk: ScopeChunk;
  attempt: number;
}

interface SwarmTaskOutcome {
  result?: SwarmWorkerResult;
  requeue?: QueuedSwarmTask[];
}

interface SwarmDeadline {
  startedAtMs: number;
  deadlineMs: number;
}

interface ScopeUnitStat {
  entry: string;
  directory: boolean;
  hidden: boolean;
  manifest: boolean;
  sourceLike: boolean;
  testLike: boolean;
  fileCount: number;
  sourceFileCount: number;
}

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|py|go|java|rs|cs|rb|php)$/i;
const ROOT_MANIFEST_FILES = new Set([
  "package.json",
  "requirements.txt",
  "go.mod",
  "pom.xml",
  "Cargo.toml",
  "Gemfile",
  "composer.json"
]);
const SOURCE_LIKE_SCOPE_PATTERN =
  /^(src|app|apps|server|api|core|lib|packages|services|service|modules|module|features|feature|analysis|agents|cli|governance|planning|memory|shared|tools)$/i;

type ResourcePressure = SwarmRunResult["parallelism"]["pressure"];
type ScopeBias = SwarmRunResult["chunking"]["scopeBias"];

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function extractJsonObject(input: string): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
}

type StructuredSectionKey = "body" | "headline" | "summary" | "findings" | "recommendations" | "priorities" | "next_steps";

function stripCodeFences(input: string): string {
  return input
    .trim()
    .replace(/^```(?:json|markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeSectionKey(rawKey: string): StructuredSectionKey | undefined {
  const normalized = rawKey.trim().toLowerCase().replace(/\s+/g, " ");

  if (normalized === "headline") {
    return "headline";
  }
  if (normalized === "summary" || normalized === "overview") {
    return "summary";
  }
  if (normalized === "findings" || normalized === "issues" || normalized === "risks" || normalized === "observations") {
    return "findings";
  }
  if (normalized === "recommendations" || normalized === "actions" || normalized === "action items") {
    return "recommendations";
  }
  if (normalized === "priorities") {
    return "priorities";
  }
  if (normalized === "next steps" || normalized === "next_steps" || normalized === "next-step" || normalized === "next step") {
    return "next_steps";
  }

  return undefined;
}

function parseStructuredSections(input: string): Partial<Record<StructuredSectionKey, string[]>> {
  const cleaned = stripCodeFences(input);
  const sections: Partial<Record<StructuredSectionKey, string[]>> = {
    body: []
  };
  let currentSection: StructuredSectionKey = "body";

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^(?:#{1,6}\s*)?([A-Za-z][A-Za-z _-]+?)(?::\s*(.*))?$/);
    const sectionKey = headingMatch ? normalizeSectionKey(headingMatch[1] ?? "") : undefined;
    if (sectionKey) {
      currentSection = sectionKey;
      sections[currentSection] ??= [];
      const inlineValue = headingMatch?.[2]?.trim();
      if (inlineValue) {
        sections[currentSection]!.push(inlineValue);
      }
      continue;
    }

    sections[currentSection] ??= [];
    sections[currentSection]!.push(line);
  }

  return sections;
}

function stripListPrefix(value: string): string {
  return value.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

function sectionToList(lines: string[] | undefined): string[] {
  if (!lines || lines.length === 0) {
    return [];
  }

  return lines
    .map((line) => stripListPrefix(line))
    .filter((line) => line.length > 0);
}

function sectionToText(lines: string[] | undefined): string {
  if (!lines || lines.length === 0) {
    return "";
  }

  return lines
    .map((line) => stripListPrefix(line))
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeProfile(value: unknown): SwarmPlanTask["profile"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "worker" || normalized === "reviewer" || normalized === "reasoning" || normalized === "planner" || normalized === "synthesizer") {
    return normalized;
  }

  return undefined;
}

function buildFallbackPlan(intent: string): PlannerPayload {
  return {
    overview: `This swarm run breaks the request into bounded repository scanning, risk review, and implementation reasoning for: ${intent}`,
    tasks: [
      {
        taskId: "scan-scope",
        title: "Scan project scope",
        goal: "Identify the main stack, repo shape, and obvious hotspots tied to the request.",
        profile: "worker",
        deliverable: "Short scan of relevant modules and project characteristics."
      },
      {
        taskId: "review-risks",
        title: "Review critical risks",
        goal: "Surface concrete technical, security, or process risks related to the request.",
        profile: "reviewer",
        deliverable: "Findings and improvement recommendations."
      },
      {
        taskId: "reason-next-steps",
        title: "Reason about next steps",
        goal: "Turn the scan and risk review into practical next steps and tradeoffs.",
        profile: "reasoning",
        deliverable: "Decision-oriented next-step guidance."
      }
    ]
  };
}

function normalizePlannerPayload(raw: string, intent: string): PlannerPayload {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return buildFallbackPlan(intent);
  }

  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .map((task, index): SwarmPlanTask | undefined => {
          if (!task || typeof task !== "object" || Array.isArray(task)) {
            return undefined;
          }

          const record = task as Record<string, unknown>;
          const title = typeof record.title === "string" ? record.title.trim() : "";
          const goal = typeof record.goal === "string" ? record.goal.trim() : "";
          const deliverable = typeof record.deliverable === "string" ? record.deliverable.trim() : "";
          const profile = normalizeProfile(record.profile) ?? (index === 0 ? "worker" : index === 1 ? "reviewer" : "reasoning");

          if (!title || !goal || !deliverable) {
            return undefined;
          }

          return {
            taskId: typeof record.taskId === "string" && record.taskId.trim().length > 0 ? record.taskId.trim() : `task-${index + 1}`,
            title,
            goal,
            profile,
            deliverable
          };
        })
        .filter((task): task is SwarmPlanTask => Boolean(task))
        .slice(0, 4)
    : [];

  if (tasks.length === 0) {
    return buildFallbackPlan(intent);
  }

  return {
    overview:
      typeof parsed.overview === "string" && parsed.overview.trim().length > 0
        ? parsed.overview.trim()
        : buildFallbackPlan(intent).overview,
    tasks
  };
}

function normalizeWorkerPayload(raw: string, task: SwarmPlanTask): WorkerPayload {
  const parsed = extractJsonObject(raw);
  if (parsed) {
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : `The ${task.title} worker finished without a summary.`,
      findings: normalizeStringList(parsed.findings),
      recommendations: normalizeStringList(parsed.recommendations)
    };
  }

  const sections = parseStructuredSections(raw);
  const findings = sectionToList(sections.findings);
  const recommendations = sectionToList((sections.recommendations?.length ?? 0) > 0 ? sections.recommendations : sections.next_steps);
  const summary = sectionToText(sections.summary) || sectionToText(sections.body);

  if (summary || findings.length > 0 || recommendations.length > 0) {
    return {
      summary: summary || `The ${task.title} worker returned partial structured text.`,
      findings,
      recommendations
    };
  }

  return {
    summary: `The ${task.title} worker could not return structured JSON.`,
    findings: [],
    recommendations: []
  };
}

function normalizeSynthesisPayload(raw: string, intent: string): SynthesisPayload {
  const parsed = extractJsonObject(raw);
  if (parsed) {
    return {
      headline:
        typeof parsed.headline === "string" && parsed.headline.trim().length > 0
          ? parsed.headline.trim()
          : `Completed a bounded swarm review for: ${intent}`,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : "The swarm synthesized the delegated outputs.",
      priorities: normalizeStringList(parsed.priorities),
      next_steps: normalizeStringList(parsed.next_steps)
    };
  }

  const sections = parseStructuredSections(raw);
  const headline = sectionToText(sections.headline);
  const summary = sectionToText(sections.summary) || sectionToText(sections.body);
  const priorities = sectionToList(sections.priorities);
  const nextSteps = sectionToList((sections.next_steps?.length ?? 0) > 0 ? sections.next_steps : sections.recommendations);

  if (headline || summary || priorities.length > 0 || nextSteps.length > 0) {
    return {
      headline: headline || `Completed a bounded swarm review for: ${intent}`,
      summary: summary || "The swarm synthesized the delegated outputs.",
      priorities,
      next_steps: nextSteps
    };
  }

  return {
    headline: `Completed a bounded swarm review for: ${intent}`,
    summary: "The swarm finished, but synthesis did not return structured JSON.",
    priorities: [],
    next_steps: []
  };
}

function taskTypeForProfile(profile: ModelProfile): AIRouterTask {
  if (profile === "reviewer") {
    return "code-smell-detection";
  }
  if (profile === "planner") {
    return "architecture-review";
  }
  if (profile === "synthesizer") {
    return "report-synthesis";
  }
  return "generic-analysis";
}

function recommendedChunkSize(
  context: ProjectContext,
  requested?: number,
  scopeBias: ScopeBias = "balanced"
): SwarmRunResult["chunking"] {
  const sourceFileCount = context.discovery.structure.sourceFileCount;
  const scopeUnits = Math.max(context.discovery.structure.topLevelDirectories.length, 1);
  const adaptiveChunkSize =
    sourceFileCount >= 800 ? 1
    : sourceFileCount >= 250 ? 2
    : sourceFileCount >= 120 ? 3
    : 4;
  const selectedChunkSize = requested ? clamp(Math.trunc(requested), 1, 6) : adaptiveChunkSize;

  return {
    selectedChunkSize,
    requestedChunkSize: requested,
    scopeUnits,
    scopeChunks: 0,
    queuedTasks: 0,
    queueStrategy: "round-robin",
    scopeBias,
    scopeHints: []
  };
}

function recommendedParallelism(requested?: number): SwarmRunResult["parallelism"] {
  const cpuCount = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const loadAverage1m = Number(os.loadavg()[0]?.toFixed(2) ?? 0);
  const totalMemoryMb = Math.round(os.totalmem() / 1024 / 1024);
  const freeMemoryMb = Math.round(os.freemem() / 1024 / 1024);
  const baseParallelism = clamp(Math.floor(cpuCount / 2), 2, 4);
  const highLoad = loadAverage1m >= cpuCount * 0.75;
  const lowMemory = freeMemoryMb < 2048;
  const adaptiveParallelism = highLoad || lowMemory ? Math.max(1, baseParallelism - 1) : baseParallelism;
  const selected = requested ? clamp(Math.trunc(requested), 1, 8) : adaptiveParallelism;
  const pressure = deriveResourcePressure({
    cpuCount,
    loadAverage1m,
    freeMemoryMb
  });

  return {
    selected,
    requested,
    cpuCount,
    loadAverage1m,
    freeMemoryMb,
    totalMemoryMb,
    pressure
  };
}

function recommendedResilience(requestedTimeoutMs?: number, requestedRetries?: number): SwarmRunResult["resilience"] {
  return {
    runTimeoutMs: 90_000,
    plannerTimeoutMs: 18_000,
    synthesisTimeoutMs: 15_000,
    taskTimeoutMs: requestedTimeoutMs ? clamp(Math.trunc(requestedTimeoutMs), 5_000, 120_000) : 20_000,
    requestedTaskTimeoutMs: requestedTimeoutMs,
    queueBudget: 0,
    maxRetries: requestedRetries ? clamp(Math.trunc(requestedRetries), 0, 4) : 1,
    plannerTimedOut: false,
    synthesisTimedOut: false,
    runTimedOut: false,
    timedOutTasks: 0,
    retriedTasks: 0,
    splitTasks: 0,
    failedTasks: 0,
    droppedTasks: 0,
    localBudgetMode: false,
    adaptiveQueueBudget: false
  };
}

export function deriveResourcePressure(parallelism: Pick<SwarmRunResult["parallelism"], "cpuCount" | "loadAverage1m" | "freeMemoryMb">): ResourcePressure {
  const loadRatio = parallelism.cpuCount > 0 ? parallelism.loadAverage1m / parallelism.cpuCount : 0;

  if (loadRatio >= 0.75 || parallelism.freeMemoryMb < 1024) {
    return "high";
  }

  if (loadRatio >= 0.5 || parallelism.freeMemoryMb < 2048) {
    return "medium";
  }

  return "low";
}

export function deriveAdaptiveQueueBudget(
  parallelism: Pick<SwarmRunResult["parallelism"], "selected" | "cpuCount" | "loadAverage1m" | "freeMemoryMb">
): number {
  const pressure = deriveResourcePressure(parallelism);
  const balancedBudget = Math.max(parallelism.selected * 4, 12);

  if (pressure === "high") {
    return Math.max(parallelism.selected * 2, 6);
  }

  if (pressure === "medium") {
    return Math.max(parallelism.selected * 3, 8);
  }

  return balancedBudget;
}

export function deriveSplitGroupSize(pressure: ResourcePressure, localBudgetMode: boolean): number {
  if (localBudgetMode && pressure === "high") {
    return 1;
  }

  if (localBudgetMode && pressure === "medium") {
    return 2;
  }

  if (localBudgetMode) {
    return 3;
  }

  if (pressure === "high") {
    return 2;
  }

  if (pressure === "medium") {
    return 3;
  }

  return 4;
}

function applyResilienceOverrides(
  resilience: SwarmRunResult["resilience"],
  options: SwarmRuntimeOptions,
  parallelism: SwarmRunResult["parallelism"]
): void {
  resilience.runTimeoutMs = options.runTimeoutMs ? clamp(Math.trunc(options.runTimeoutMs), 10_000, 600_000) : 90_000;
  resilience.requestedRunTimeoutMs = options.runTimeoutMs;
  resilience.plannerTimeoutMs = options.plannerTimeoutMs
    ? clamp(Math.trunc(options.plannerTimeoutMs), 3_000, resilience.runTimeoutMs)
    : Math.min(18_000, resilience.runTimeoutMs);
  resilience.requestedPlannerTimeoutMs = options.plannerTimeoutMs;
  resilience.synthesisTimeoutMs = options.synthesisTimeoutMs
    ? clamp(Math.trunc(options.synthesisTimeoutMs), 3_000, resilience.runTimeoutMs)
    : Math.min(15_000, resilience.runTimeoutMs);
  resilience.requestedSynthesisTimeoutMs = options.synthesisTimeoutMs;
  resilience.adaptiveQueueBudget = !options.maxQueuedTasks;
  resilience.queueBudget = options.maxQueuedTasks
    ? clamp(Math.trunc(options.maxQueuedTasks), parallelism.selected, 64)
    : deriveAdaptiveQueueBudget(parallelism);
  resilience.requestedQueueBudget = options.maxQueuedTasks;
}

function shouldUseLocalBudgetMode(resilience: SwarmRunResult["resilience"]): boolean {
  return (
    resilience.runTimeoutMs <= 45_000 ||
    resilience.plannerTimeoutMs <= 8_000 ||
    resilience.synthesisTimeoutMs <= 8_000
  );
}

async function mapWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

async function drainQueueWithConcurrency(
  queue: QueuedSwarmTask[],
  concurrency: number,
  worker: (task: QueuedSwarmTask) => Promise<SwarmTaskOutcome>
): Promise<SwarmWorkerResult[]> {
  const results: SwarmWorkerResult[] = [];

  async function runWorker(): Promise<void> {
    while (true) {
      const task = queue.shift();
      if (!task) {
        return;
      }

      const outcome = await worker(task);
      if (outcome.result) {
        results.push(outcome.result);
      }
      if (outcome.requeue && outcome.requeue.length > 0) {
        queue.push(...outcome.requeue);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(queue.length, 1)) }, () => runWorker()));
  return results;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function buildScopeUnitStat(context: ProjectContext, scopePath: string): ScopeUnitStat {
  const normalized = scopePath.trim().replace(/^\.\/+/, "") || ".";
  const baseName = normalized === "." ? "." : path.posix.basename(normalized);
  const fileCount = context.discovery.files.filter((file) => file === normalized || file.startsWith(`${normalized}/`)).length;
  const sourceFileCount = context.discovery.files.filter(
    (file) => (file === normalized || file.startsWith(`${normalized}/`)) && SOURCE_FILE_PATTERN.test(file)
  ).length;

  return {
    entry: normalized,
    directory: context.discovery.files.some((file) => file.startsWith(`${normalized}/`)),
    hidden: baseName.startsWith("."),
    manifest: ROOT_MANIFEST_FILES.has(baseName),
    sourceLike: SOURCE_LIKE_SCOPE_PATTERN.test(baseName),
    testLike: /(^|\/)(__tests__|tests?|spec)$/i.test(baseName),
    fileCount,
    sourceFileCount
  };
}

function scoreScopeUnit(stat: ScopeUnitStat, scopeBias: ScopeBias): number {
  const sourceLikeBoost = scopeBias === "source-first" ? 90 : 35;
  const testPenalty = scopeBias === "source-first" ? -140 : -25;
  const manifestBonus = scopeBias === "source-first" ? 15 : 30;

  return (
    (stat.directory ? 40 : 0) +
    (stat.hidden ? -20 : 20) +
    (stat.sourceLike ? sourceLikeBoost : 0) +
    (stat.testLike ? testPenalty : 0) +
    (stat.sourceFileCount > 0 ? 100 + stat.sourceFileCount * 5 : stat.manifest ? manifestBonus : Math.min(stat.fileCount, 10)) +
    (!stat.directory && !stat.manifest && stat.sourceFileCount === 0 ? -30 : 0)
  );
}

function normalizeHintPath(value: string): string {
  return value.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
}

function matchesScopeHint(entry: string, scopeHints: string[]): boolean {
  const normalizedEntry = normalizeHintPath(entry);

  return scopeHints.some((hint) => {
    const normalizedHint = normalizeHintPath(hint);
    return (
      normalizedHint === normalizedEntry ||
      normalizedHint.startsWith(`${normalizedEntry}/`) ||
      normalizedEntry.startsWith(`${normalizedHint}/`)
    );
  });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractIntentScopeHints(context: ProjectContext, intent: string): string[] {
  const hints = new Set<string>();
  const normalizedIntent = intent.trim();

  for (const match of normalizedIntent.matchAll(/\b([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\b/g)) {
    const candidate = normalizeHintPath(match[1] ?? "");
    if (!candidate) {
      continue;
    }

    if (context.discovery.files.some((file) => file === candidate || file.startsWith(`${candidate}/`))) {
      hints.add(candidate);
      continue;
    }

    const topLevelCandidate = candidate.split("/")[0];
    if (topLevelCandidate && context.discovery.structure.topLevelDirectories.includes(topLevelCandidate)) {
      hints.add(candidate);
    }
  }

  for (const topLevelDirectory of context.discovery.structure.topLevelDirectories) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(topLevelDirectory)}($|[^A-Za-z0-9_])`, "i");
    if (pattern.test(normalizedIntent)) {
      hints.add(topLevelDirectory);
    }
  }

  return [...hints];
}

function prioritizeScopePaths(
  context: ProjectContext,
  scopePaths: string[],
  scopeBias: ScopeBias,
  scopeHints: string[] = []
): string[] {
  const stats: ScopeUnitStat[] = uniqueStrings(scopePaths).map((scopePath) => buildScopeUnitStat(context, scopePath));

  return stats
    .sort((left, right) => {
      const leftHint = matchesScopeHint(left.entry, scopeHints);
      const rightHint = matchesScopeHint(right.entry, scopeHints);
      if (leftHint !== rightHint) {
        return rightHint ? 1 : -1;
      }

      const leftScore = scoreScopeUnit(left, scopeBias);
      const rightScore = scoreScopeUnit(right, scopeBias);

      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      if (right.sourceFileCount !== left.sourceFileCount) {
        return right.sourceFileCount - left.sourceFileCount;
      }
      if (right.fileCount !== left.fileCount) {
        return right.fileCount - left.fileCount;
      }
      return left.entry.localeCompare(right.entry);
    })
    .map((entry) => entry.entry);
}

function prioritizeScopeUnits(context: ProjectContext, scopeBias: ScopeBias, scopeHints: string[] = []): string[] {
  return prioritizeScopePaths(context, context.discovery.structure.topLevelDirectories, scopeBias, scopeHints);
}

function createScopeChunks(context: ProjectContext, chunkSize: number, scopeBias: ScopeBias, scopeHints: string[] = []): ScopeChunk[] {
  const directories = prioritizeScopeUnits(context, scopeBias, scopeHints);
  const scopeUnits = directories.length > 0 ? directories : ["."];
  const chunks: ScopeChunk[] = [];

  for (let index = 0; index < scopeUnits.length; index += chunkSize) {
    const group = scopeUnits.slice(index, index + chunkSize);
    chunks.push({
      chunkId: `scope-${chunks.length + 1}`,
      label: group.join(", "),
      scopePaths: group
    });
  }

  return chunks.slice(0, 6);
}

function createQueuedTasks(
  planner: PlannerPayload,
  scopeChunks: ScopeChunk[],
  parallelism: number,
  queueBudget: number
): QueuedSwarmTask[] {
  const maxQueuedTasks = Math.max(Math.min(queueBudget, 64), planner.tasks.length, parallelism);
  const queue: QueuedSwarmTask[] = [];

  for (let chunkIndex = 0; chunkIndex < scopeChunks.length; chunkIndex += 1) {
    const chunk = scopeChunks[chunkIndex]!;
    for (const task of planner.tasks) {
      queue.push({
        taskId: `${task.taskId}__${chunk.chunkId}`,
        parentTaskId: task.taskId,
        title: `${task.title} [${chunk.label}]`,
        goal: task.goal,
        profile: task.profile,
        deliverable: task.deliverable,
        chunk,
        attempt: 1
      });

      if (queue.length >= maxQueuedTasks) {
        return queue;
      }
    }
  }

  return queue;
}

function totalPotentialQueuedTasks(planner: PlannerPayload, scopeChunks: ScopeChunk[]): number {
  return planner.tasks.length * scopeChunks.length;
}

function createDeadline(runTimeoutMs: number): SwarmDeadline {
  const startedAtMs = Date.now();
  return {
    startedAtMs,
    deadlineMs: startedAtMs + runTimeoutMs
  };
}

function remainingBudgetMs(deadline: SwarmDeadline): number {
  return Math.max(0, deadline.deadlineMs - Date.now());
}

function listImmediateChildScopePaths(
  context: ProjectContext,
  scopePath: string,
  scopeBias: ScopeBias,
  scopeHints: string[] = []
): string[] {
  const normalizedScope = scopePath.trim().replace(/^\.\/+/, "") || ".";
  const prefix = normalizedScope === "." ? "" : `${normalizedScope}/`;
  const children = new Set<string>();

  for (const file of context.discovery.files) {
    if (normalizedScope !== "." && !(file === normalizedScope || file.startsWith(prefix))) {
      continue;
    }

    const relative = normalizedScope === "." ? file : file.slice(prefix.length);
    if (!relative || relative === file && file === normalizedScope) {
      continue;
    }

    const [head] = relative.split("/");
    if (!head) {
      continue;
    }

    children.add(normalizedScope === "." ? head : `${normalizedScope}/${head}`);
  }

  return prioritizeScopePaths(context, [...children], scopeBias, scopeHints);
}

function groupScopePaths(scopePaths: string[], maxGroupSize: number): string[][] {
  const groups: string[][] = [];
  const safeGroupSize = Math.max(1, maxGroupSize);

  for (let index = 0; index < scopePaths.length; index += safeGroupSize) {
    groups.push(scopePaths.slice(index, index + safeGroupSize));
  }

  return groups;
}

function splitScopeChunk(
  context: ProjectContext,
  chunk: ScopeChunk,
  scopeBias: ScopeBias,
  scopeHints: string[],
  pressure: ResourcePressure,
  localBudgetMode: boolean
): ScopeChunk[] {
  const splitGroupSize = deriveSplitGroupSize(pressure, localBudgetMode);

  if (chunk.scopePaths.length === 1) {
    const childScopePaths = listImmediateChildScopePaths(context, chunk.scopePaths[0]!, scopeBias, scopeHints);
    if (childScopePaths.length <= 1) {
      return [];
    }

    const childGroups = groupScopePaths(childScopePaths, splitGroupSize);
    return childGroups.map((scopePaths, index) => ({
      chunkId: `${chunk.chunkId}.${index + 1}`,
      label: scopePaths.join(", "),
      scopePaths
    }));
  }

  const effectiveGroupSize = Math.max(1, Math.min(splitGroupSize, chunk.scopePaths.length - 1));
  const parts = groupScopePaths(chunk.scopePaths, effectiveGroupSize).filter((group) => group.length > 0);

  return parts.map((scopePaths, index) => ({
    chunkId: `${chunk.chunkId}.${index + 1}`,
    label: scopePaths.join(", "),
    scopePaths
  }));
}

function buildChunkContext(context: ProjectContext, scopePaths: string[]): string {
  const relevantFiles = context.discovery.files.filter((file) =>
    scopePaths.some((scopePath) => scopePath === "." || file === scopePath || file.startsWith(`${scopePath}/`))
  );
  const sampleFiles = relevantFiles.slice(0, 10);
  const sourceFiles = relevantFiles.filter((file) => !/(^|\/)(tests?|spec)\//i.test(file)).length;
  const testFiles = relevantFiles.length - sourceFiles;

  return [
    `Repository: ${context.repoName}`,
    `Focus scope: ${scopePaths.join(", ")}`,
    `Scoped file count: ${relevantFiles.length}`,
    `Scoped source files: ${sourceFiles}`,
    `Scoped test files: ${testFiles}`,
    `Sample files: ${sampleFiles.join(", ") || "None"}`,
    `Languages: ${context.discovery.languages.join(", ") || "Unknown"}`,
    `Frameworks: ${context.discovery.frameworks.join(", ") || "Unknown"}`,
    `Testing: ${context.discovery.testing.join(", ") || "Not detected"}`
  ].join("\n");
}

function buildPlannerPrompt(context: ProjectContext, intent: string): AIRouterRequest {
  return {
    task: "intent-routing",
    profile: "planner",
    context: buildRepoSummary(context),
    prompt: [
      "You are planning a bounded model swarm for project-brain.",
      "Do not invent repository facts.",
      "Split the user request into at most 4 small analysis tasks.",
      "Each task must fit one profile: worker, reviewer, or reasoning.",
      "Return JSON only in this shape:",
      '{ "overview": string, "tasks": [{ "taskId": string, "title": string, "goal": string, "profile": "worker|reviewer|reasoning", "deliverable": string }] }',
      `User intent: ${intent}`
    ].join("\n")
  };
}

function buildWorkerPrompt(context: ProjectContext, intent: string, overview: string, task: QueuedSwarmTask): AIRouterRequest {
  return {
    task: taskTypeForProfile(task.profile as ModelProfile),
    profile: task.profile as ModelProfile,
    allowRemote: task.profile === "planner" || task.profile === "synthesizer",
    context: buildChunkContext(context, task.chunk.scopePaths),
    prompt: [
      "You are a bounded worker inside a project-brain swarm.",
      "Use only the scoped repository context provided.",
      "Do not assume facts that are not in the repository summary.",
      "Return JSON only in this shape:",
      '{ "summary": string, "findings": string[], "recommendations": string[] }',
      `User intent: ${intent}`,
      `Swarm overview: ${overview}`,
      `Task title: ${task.title}`,
      `Attempt: ${task.attempt}`,
      `Task goal: ${task.goal}`,
      `Scope chunk: ${task.chunk.label}`,
      `Scope paths: ${task.chunk.scopePaths.join(", ")}`,
      `Expected deliverable: ${task.deliverable}`
    ].join("\n")
  };
}

function buildSynthesisPrompt(intent: string, overview: string, workerResults: SwarmWorkerResult[]): AIRouterRequest {
  return {
    task: "report-synthesis",
    profile: "synthesizer",
    prompt: [
      "You are the synthesizer for a project-brain swarm run.",
      "Merge the worker outputs into a concise, decision-oriented result.",
      "Return JSON only in this shape:",
      '{ "headline": string, "summary": string, "priorities": string[], "next_steps": string[] }',
      `User intent: ${intent}`,
      `Swarm overview: ${overview}`,
      "Worker outputs:",
      JSON.stringify(workerResults, null, 2)
    ].join("\n")
  };
}

function renderSwarmReport(
  context: ProjectContext,
  intent: string,
  resilience: SwarmRunResult["resilience"],
  chunking: SwarmRunResult["chunking"],
  parallelism: SwarmRunResult["parallelism"],
  plannerSelection: ModelSelection,
  planner: PlannerPayload,
  workerResults: SwarmWorkerResult[],
  synthesisSelection: ModelSelection,
  synthesis: SynthesisPayload
): string {
  return `# Swarm Run

## Intent

- Repository: ${context.repoName}
- Intent: ${intent}

## Planner

- Run timeout: ${resilience.runTimeoutMs} ms
- Planner timeout: ${resilience.plannerTimeoutMs} ms
- Synthesis timeout: ${resilience.synthesisTimeoutMs} ms
- Worker timeout: ${resilience.taskTimeoutMs} ms
- Local budget mode: ${resilience.localBudgetMode ? "yes" : "no"}
- Adaptive queue budget: ${resilience.adaptiveQueueBudget ? "yes" : "no"}
- Queue budget: ${resilience.queueBudget}
- Max retries: ${resilience.maxRetries}
- Planner timed out: ${resilience.plannerTimedOut ? "yes" : "no"}
- Synthesis timed out: ${resilience.synthesisTimedOut ? "yes" : "no"}
- Run timed out: ${resilience.runTimedOut ? "yes" : "no"}
- Timed out tasks: ${resilience.timedOutTasks}
- Retried tasks: ${resilience.retriedTasks}
- Split tasks: ${resilience.splitTasks}
- Failed tasks: ${resilience.failedTasks}
- Dropped tasks: ${resilience.droppedTasks}
- Chunk size: ${chunking.selectedChunkSize}${chunking.requestedChunkSize ? ` (requested=${chunking.requestedChunkSize})` : ""}
- Queue strategy: ${chunking.queueStrategy}
- Scope bias: ${chunking.scopeBias}
- Scope hints: ${chunking.scopeHints.join(", ") || "None"}
- Scope units: ${chunking.scopeUnits}
- Scope chunks: ${chunking.scopeChunks}
- Queued worker tasks: ${chunking.queuedTasks}
- Parallel workers: ${parallelism.selected}${parallelism.requested ? ` (requested=${parallelism.requested})` : ""}
- CPU cores seen: ${parallelism.cpuCount}
- Load average (1m): ${parallelism.loadAverage1m}
- Free memory: ${parallelism.freeMemoryMb} MB
- Resource pressure: ${parallelism.pressure}
- Model: ${plannerSelection.model}
- Provider: ${plannerSelection.provider}
- Profile: ${plannerSelection.profile}
- Residency: ${plannerSelection.residency}
- Overview: ${planner.overview}

## Delegated tasks

${planner.tasks
  .map(
    (task) => `### ${task.title}

- Task ID: ${task.taskId}
- Profile: ${task.profile}
- Goal: ${task.goal}
- Deliverable: ${task.deliverable}`
  )
  .join("\n\n")}

## Worker outputs

${workerResults
  .map(
    (result) => `### ${result.title}

- Parent task: ${result.parentTaskId}
- Chunk: ${result.chunkId}
- Attempt: ${result.attempt}
- Status: ${result.status}
- Scope: ${result.scopePaths.join(", ")}
- Model: ${result.model}
- Provider: ${result.provider}
- Profile: ${result.profile}
- Residency: ${result.residency}
- Summary: ${result.summary}

${result.error ? `- Error: ${result.error}\n` : ""}

Findings:
${renderList(result.findings)}

Recommendations:
${renderList(result.recommendations)}`
  )
  .join("\n\n")}

## Synthesis

- Model: ${synthesisSelection.model}
- Provider: ${synthesisSelection.provider}
- Profile: ${synthesisSelection.profile}
- Residency: ${synthesisSelection.residency}
- Headline: ${synthesis.headline}

${synthesis.summary}

### Priorities

${renderList(synthesis.priorities)}

### Next steps

${renderList(synthesis.next_steps)}
`;
}

export async function runSwarm(
  context: ProjectContext,
  intent: string,
  assistant: SwarmAssistant,
  options: SwarmRuntimeOptions = {}
): Promise<SwarmRunResult> {
  const parallelism = recommendedParallelism(options.parallelism);
  const chunking = recommendedChunkSize(context, options.chunkSize, options.scopeBias ?? "balanced");
  chunking.scopeHints = extractIntentScopeHints(context, intent);
  const resilience = recommendedResilience(options.taskTimeoutMs, options.maxRetries);
  applyResilienceOverrides(resilience, options, parallelism);
  resilience.localBudgetMode = shouldUseLocalBudgetMode(resilience);
  if (resilience.localBudgetMode && !parallelism.requested) {
    parallelism.selected = Math.min(parallelism.selected, 2);
  }
  if (resilience.localBudgetMode && resilience.adaptiveQueueBudget) {
    resilience.queueBudget = Math.min(resilience.queueBudget, Math.max(parallelism.selected * 2 + 2, 6));
  }
  const deadline = createDeadline(resilience.runTimeoutMs);
  const plannerRequest: AIRouterRequest = {
    ...buildPlannerPrompt(context, intent),
    allowRemote: !resilience.localBudgetMode,
    timeoutMs: Math.min(resilience.plannerTimeoutMs, remainingBudgetMs(deadline))
  };
  const plannerSelection = await assistant.selectModel(plannerRequest);
  let planner: PlannerPayload;

  try {
    const plannerResponse = await assistant.ask(plannerRequest);
    planner = normalizePlannerPayload(plannerResponse, intent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) {
      resilience.plannerTimedOut = true;
      planner = buildFallbackPlan(intent);
    } else {
      throw error;
    }
  }

  const scopeChunks = createScopeChunks(context, chunking.selectedChunkSize, chunking.scopeBias, chunking.scopeHints);
  const queuedTasks = createQueuedTasks(planner, scopeChunks, parallelism.selected, resilience.queueBudget);
  chunking.scopeChunks = scopeChunks.length;
  chunking.queuedTasks = queuedTasks.length;
  resilience.droppedTasks = Math.max(0, totalPotentialQueuedTasks(planner, scopeChunks) - queuedTasks.length);

  const workerResults = await drainQueueWithConcurrency(
    [...queuedTasks],
    parallelism.selected,
    async (task): Promise<SwarmTaskOutcome> => {
      const remainingMs = remainingBudgetMs(deadline);
      if (remainingMs <= 0) {
        resilience.runTimedOut = true;
        resilience.droppedTasks += 1;
        return {
          result: {
            taskId: task.taskId,
            parentTaskId: task.parentTaskId,
            chunkId: task.chunk.chunkId,
            attempt: task.attempt,
            status: "timed_out",
            title: task.title,
            profile: task.profile,
            scopePaths: task.chunk.scopePaths,
            provider: "ollama",
            model: "budget-exhausted",
            residency: "local",
            summary: "The global swarm time budget was exhausted before this task could run.",
            findings: [],
            recommendations: ["Increase the run timeout or reduce the queue budget/chunk size."],
            error: "Run timeout exceeded before task execution."
          }
        };
      }

      const request = buildWorkerPrompt(context, intent, planner.overview, {
        ...task
      });
      const timedRequest: AIRouterRequest = {
        ...request,
        timeoutMs: Math.min(resilience.taskTimeoutMs, remainingMs)
      };

      try {
        const selection = await assistant.selectModel(timedRequest);
        const response = await assistant.ask(timedRequest);
        const payload = normalizeWorkerPayload(response, {
          taskId: task.taskId,
          title: task.title,
          goal: task.goal,
          profile: task.profile,
          deliverable: task.deliverable
        });

        return {
          result: {
            taskId: task.taskId,
            parentTaskId: task.parentTaskId,
            chunkId: task.chunk.chunkId,
            attempt: task.attempt,
            status: "completed",
            title: task.title,
            profile: task.profile,
            scopePaths: task.chunk.scopePaths,
            provider: selection.provider,
            model: selection.model,
            residency: selection.residency,
            summary: payload.summary,
            findings: payload.findings,
            recommendations: payload.recommendations
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const timedOut = /abort|timeout/i.test(message);
        if (timedOut) {
          resilience.timedOutTasks += 1;
        }

        if (timedOut) {
          const splitChunks = splitScopeChunk(
            context,
            task.chunk,
            chunking.scopeBias,
            chunking.scopeHints,
            parallelism.pressure,
            resilience.localBudgetMode
          );
          if (splitChunks.length > 0) {
            resilience.splitTasks += splitChunks.length;
            return {
              requeue: splitChunks.map((chunk) => ({
                taskId: `${task.parentTaskId}__${chunk.chunkId}`,
                parentTaskId: task.parentTaskId,
                title: `${task.title.split(" [")[0]} [${chunk.label}]`,
                goal: task.goal,
                profile: task.profile,
                deliverable: task.deliverable,
                chunk,
                attempt: task.attempt + 1
              }))
            };
          }
        }

        if (task.attempt <= resilience.maxRetries) {
          resilience.retriedTasks += 1;
          return {
            requeue: [
              {
                ...task,
                attempt: task.attempt + 1
              }
            ]
          };
        }

        resilience.failedTasks += 1;
        const selection = await assistant.selectModel(timedRequest);
        return {
          result: {
            taskId: task.taskId,
            parentTaskId: task.parentTaskId,
            chunkId: task.chunk.chunkId,
            attempt: task.attempt,
            status: timedOut ? "timed_out" : "failed",
            title: task.title,
            profile: task.profile,
            scopePaths: task.chunk.scopePaths,
            provider: selection.provider,
            model: selection.model,
            residency: selection.residency,
            summary: timedOut
              ? `The worker exceeded the time budget for this scope chunk.`
              : `The worker failed before producing structured output.`,
            findings: [],
            recommendations: timedOut
              ? ["Reduce chunk size or increase the worker timeout for this task."]
              : ["Retry the task or inspect the affected scope manually."],
            error: message
          }
        };
      }
    }
  );

  let synthesis: SynthesisPayload;
  const synthesisRequest: AIRouterRequest = {
    ...buildSynthesisPrompt(intent, planner.overview, workerResults),
    allowRemote: !resilience.localBudgetMode,
    timeoutMs: Math.min(resilience.synthesisTimeoutMs, Math.max(remainingBudgetMs(deadline), 1_000))
  };
  const synthesisSelection = await assistant.selectModel(synthesisRequest);

  if (remainingBudgetMs(deadline) <= 0) {
    resilience.runTimedOut = true;
    resilience.synthesisTimedOut = true;
    synthesis = {
      headline: `The swarm hit its global time budget for: ${intent}`,
      summary: "The global run deadline was exhausted before synthesis could complete, so project-brain returned a partial merge from finished worker results.",
      priorities: workerResults.flatMap((result) => result.recommendations).slice(0, 5),
      next_steps: [
        "Increase the run timeout for broader swarm runs.",
        "Reduce queue budget or chunk size to finish within the current budget."
      ]
    };
  } else {
    try {
      const synthesisResponse = await assistant.ask(synthesisRequest);
      synthesis = normalizeSynthesisPayload(synthesisResponse, intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/abort|timeout/i.test(message)) {
        resilience.synthesisTimedOut = true;
        synthesis = {
          headline: `The swarm finished with a partial synthesis for: ${intent}`,
          summary: "The synthesis step exceeded its time budget, so project-brain returned a partial result from the completed worker outputs.",
          priorities: workerResults.flatMap((result) => result.recommendations).slice(0, 5),
          next_steps: [
            "Increase synthesis timeout for broader merges.",
            "Reduce queue budget or chunk size if the run must finish faster."
          ]
        };
      } else {
        throw error;
      }
    }
  }

  const reportPath = path.join(context.reportsDir, "swarm_run.md");
  const memoryPath = path.join(context.memoryDir, "swarm", "swarm_run.json");

  await writeFileEnsured(
      reportPath,
      renderSwarmReport(context, intent, resilience, chunking, parallelism, plannerSelection, planner, workerResults, synthesisSelection, synthesis)
  );
  await writeJsonEnsured(memoryPath, {
    repoName: context.repoName,
    intent,
    resilience,
    chunking,
    parallelism,
    planner: {
      selection: plannerSelection,
      overview: planner.overview,
      tasks: planner.tasks
    },
    workers: workerResults,
    synthesis: {
      selection: synthesisSelection,
      ...synthesis
    }
  });

  return {
    engine: "bounded",
    context,
    intent,
    reportPath,
    memoryPath,
    resilience,
    chunking,
    parallelism,
    planner: {
      provider: plannerSelection.provider,
      model: plannerSelection.model,
      residency: plannerSelection.residency,
      overview: planner.overview
    },
    tasks: planner.tasks,
    workerResults,
    synthesis: {
      provider: synthesisSelection.provider,
      model: synthesisSelection.model,
      residency: synthesisSelection.residency,
      headline: synthesis.headline,
      summary: synthesis.summary,
      priorities: synthesis.priorities,
      nextSteps: synthesis.next_steps
    }
  };
}
