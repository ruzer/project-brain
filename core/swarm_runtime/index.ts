import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { buildMemoryBriefSummary, buildRepoSummary } from "../../agents/ai-support";
import { loadScopeMemoryRecords, renderScopeMemoryForPrompt, writeScopeMemoryFromSwarmResult } from "../../memory/scope_store";
import { appendError, appendLearning } from "../../memory/session_log";
import { readJsonSafe, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectContext, ScopeMemoryRecord, SwarmPlanTask, SwarmRunResult, SwarmWorkerResult } from "../../shared/types";
import type { AIRouterRequest, AIRouterTask, ModelProfile, ModelSelection } from "../ai_router/router";
import { applyPresetPolicy, applyTokenPolicy, type TokenPreset } from "../token_policy";

interface SwarmAssistant {
  ask(input: AIRouterRequest): Promise<string>;
  selectModel(input: AIRouterRequest): Promise<ModelSelection>;
}

interface SwarmRuntimeOptions {
  parallelism?: number;
  chunkSize?: number;
  preset?: TokenPreset;
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
  verifiedFacts: string[];
  unknowns: string[];
  evidenceRefs: string[];
}

interface SynthesisPayload {
  headline: string;
  summary: string;
  priorities: string[];
  next_steps: string[];
  verified_facts: string[];
  unknowns: string[];
  evidence_refs: string[];
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

interface SwarmResponseCacheEntry {
  key: string;
  request: {
    task?: AIRouterTask;
    profile?: ModelProfile;
    prompt: string;
    context?: string;
    allowRemote?: boolean;
  };
  selection: Pick<ModelSelection, "provider" | "model" | "residency" | "profile">;
  response: string;
  createdAt: string;
  lastUsedAt: string;
  hits: number;
}

interface SwarmResponseCacheDocument {
  version: 1;
  updatedAt: string;
  entries: Record<string, SwarmResponseCacheEntry>;
}

interface SwarmLearningScopeRecord {
  signalScore: number;
  completedRuns: number;
  failureCount: number;
  timeoutCount: number;
  lastSeenAt: string;
}

interface SwarmLearningDocument {
  version: 1;
  updatedAt: string;
  scopes: Record<string, SwarmLearningScopeRecord>;
}

interface SwarmOptimizationStats {
  cacheHits: number;
  cacheMisses: number;
  cacheWrites: number;
  scopeMemoryHits: number;
  scopeMemoryMisses: number;
  scopeMemoryStale: number;
  scopeMemoryWrites: number;
  scopeMemoryReuseCandidates: number;
  scopeMemoryReductionHints: string[];
  derivedTasksQueued: number;
  derivedTasksSkipped: number;
  learnedScopeBoosts: string[];
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
const SWARM_RESPONSE_CACHE_MAX_ENTRIES = 160;

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

type StructuredSectionKey =
  | "body"
  | "headline"
  | "summary"
  | "findings"
  | "recommendations"
  | "priorities"
  | "next_steps"
  | "verified_facts"
  | "unknowns"
  | "evidence_refs";

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
  if (normalized === "verified facts" || normalized === "verified_facts" || normalized === "facts") {
    return "verified_facts";
  }
  if (normalized === "unknowns" || normalized === "unknown" || normalized === "not verified" || normalized === "not_verified") {
    return "unknowns";
  }
  if (normalized === "evidence refs" || normalized === "evidence_refs" || normalized === "evidence" || normalized === "sources") {
    return "evidence_refs";
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

function looksLikeCodeOnlyResponse(input: string): boolean {
  const cleaned = stripCodeFences(input);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) {
    return false;
  }

  const hasStructuredSections = lines.some((line) => {
    const headingMatch = line.match(/^(?:#{1,6}\s*)?([A-Za-z][A-Za-z _-]+?)(?::\s*(.*))?$/);
    return Boolean(headingMatch && normalizeSectionKey(headingMatch[1] ?? ""));
  });
  if (hasStructuredSections) {
    return false;
  }

  const codeSignalCount = lines.filter((line) =>
    /^(?:#!|import\s+|from\s+\S+\s+import\s+|def\s+|class\s+|for\s+|while\s+|if\s+__name__|print\(|const\s+|let\s+|var\s+|function\s+|export\s+|package\s+main|use\s+|fn\s+)/.test(line) ||
    /[{};]$/.test(line)
  ).length;

  return codeSignalCount >= Math.max(3, Math.ceil(lines.length * 0.4));
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

function normalizeTaskDependencies(tasks: SwarmPlanTask[]): SwarmPlanTask[] {
  const validTaskIds = new Set(tasks.map((task) => task.taskId));

  return tasks.map((task) => {
    const dependsOn = uniqueStrings((task.dependsOn ?? []).filter((dependencyId) => dependencyId !== task.taskId && validTaskIds.has(dependencyId)));
    return dependsOn.length > 0
      ? {
          ...task,
          dependsOn
        }
      : {
          ...task,
          dependsOn: undefined
        };
  });
}

function buildFallbackPlan(intent: string): PlannerPayload {
  return {
    overview: `This swarm run breaks the request into bounded repository scanning, risk review, and implementation reasoning for: ${intent}`,
    tasks: normalizeTaskDependencies([
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
        deliverable: "Findings and improvement recommendations.",
        dependsOn: ["scan-scope"]
      },
      {
        taskId: "reason-next-steps",
        title: "Reason about next steps",
        goal: "Turn the scan and risk review into practical next steps and tradeoffs.",
        profile: "reasoning",
        deliverable: "Decision-oriented next-step guidance.",
        dependsOn: ["scan-scope", "review-risks"]
      }
    ])
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
          const dependsOn = normalizeStringList(record.dependsOn ?? record.depends_on);

          if (!title || !goal || !deliverable) {
            return undefined;
          }

          return {
            taskId: typeof record.taskId === "string" && record.taskId.trim().length > 0 ? record.taskId.trim() : `task-${index + 1}`,
            title,
            goal,
            profile,
            deliverable,
            dependsOn
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
    tasks: normalizeTaskDependencies(tasks)
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
      recommendations: normalizeStringList(parsed.recommendations),
      verifiedFacts: normalizeStringList(parsed.verified_facts ?? parsed.verifiedFacts),
      unknowns: normalizeStringList(parsed.unknowns),
      evidenceRefs: normalizeStringList(parsed.evidence_refs ?? parsed.evidenceRefs)
    };
  }

  const sections = parseStructuredSections(raw);
  const findings = sectionToList(sections.findings);
  const recommendations = sectionToList((sections.recommendations?.length ?? 0) > 0 ? sections.recommendations : sections.next_steps);
  const summary = sectionToText(sections.summary) || sectionToText(sections.body);

  if (
    summary &&
    findings.length === 0 &&
    recommendations.length === 0 &&
    sectionToList(sections.verified_facts).length === 0 &&
    sectionToList(sections.evidence_refs).length === 0 &&
    looksLikeCodeOnlyResponse(raw)
  ) {
    return {
      summary: `The ${task.title} worker returned code instead of structured analysis.`,
      findings: [],
      recommendations: ["Rerun this worker with a narrower analysis-only prompt or a stronger structured-output model."],
      verifiedFacts: [],
      unknowns: ["Worker response looked like generated code/script instead of evidence-backed analysis."],
      evidenceRefs: []
    };
  }

  if (summary || findings.length > 0 || recommendations.length > 0) {
    return {
      summary: summary || `The ${task.title} worker returned partial structured text.`,
      findings,
      recommendations,
      verifiedFacts: sectionToList(sections.verified_facts),
      unknowns: sectionToList(sections.unknowns),
      evidenceRefs: sectionToList(sections.evidence_refs)
    };
  }

  return {
    summary: `The ${task.title} worker could not return structured JSON.`,
    findings: [],
    recommendations: [],
    verifiedFacts: [],
    unknowns: [],
    evidenceRefs: []
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
      next_steps: normalizeStringList(parsed.next_steps),
      verified_facts: normalizeStringList(parsed.verified_facts ?? parsed.verifiedFacts),
      unknowns: normalizeStringList(parsed.unknowns),
      evidence_refs: normalizeStringList(parsed.evidence_refs ?? parsed.evidenceRefs)
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
      next_steps: nextSteps,
      verified_facts: sectionToList(sections.verified_facts),
      unknowns: sectionToList(sections.unknowns),
      evidence_refs: sectionToList(sections.evidence_refs)
    };
  }

  return {
    headline: `Completed a bounded swarm review for: ${intent}`,
    summary: "The swarm finished, but synthesis did not return structured JSON.",
    priorities: [],
    next_steps: [],
    verified_facts: [],
    unknowns: [],
    evidence_refs: []
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

export function recommendedResilience(requestedTimeoutMs?: number, requestedRetries?: number): SwarmRunResult["resilience"] {
  return {
    runTimeoutMs: 90_000,
    plannerTimeoutMs: 18_000,
    synthesisTimeoutMs: 15_000,
    taskTimeoutMs: requestedTimeoutMs ? clamp(Math.trunc(requestedTimeoutMs), 5_000, 120_000) : 20_000,
    requestedTaskTimeoutMs: requestedTimeoutMs,
    queueBudget: 0,
    maxRetries: requestedRetries === undefined ? 1 : clamp(Math.trunc(requestedRetries), 0, 4),
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

async function drainTaskLevelsWithConcurrency(
  levels: QueuedSwarmTask[][],
  concurrency: number,
  worker: (task: QueuedSwarmTask) => Promise<SwarmTaskOutcome>
): Promise<SwarmWorkerResult[]> {
  const results: SwarmWorkerResult[] = [];

  for (const level of levels) {
    if (level.length === 0) {
      continue;
    }

    const levelResults = await drainQueueWithConcurrency([...level], concurrency, worker);
    results.push(...levelResults);
  }

  return results;
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function canonicalizePromptText(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/^Attempt:\s+\d+\s*$/gim, "Attempt: <retry>")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function buildSwarmCacheKey(
  context: ProjectContext,
  request: AIRouterRequest,
  selection: Pick<ModelSelection, "provider" | "model" | "residency" | "profile">
): string {
  return createHash("sha256")
    .update(
      stableSerialize({
        repoName: context.repoName,
        targetPath: context.targetPath,
        gitCommit: context.discovery.git.latestCommit ?? "",
        request: {
          task: request.task,
          profile: request.profile,
          allowRemote: request.allowRemote,
          prompt: canonicalizePromptText(request.prompt),
          context: canonicalizePromptText(request.context)
        },
        selection
      })
    )
    .digest("hex");
}

function createEmptySwarmResponseCache(): SwarmResponseCacheDocument {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: {}
  };
}

function normalizeSwarmResponseCache(document: SwarmResponseCacheDocument | undefined): SwarmResponseCacheDocument {
  if (!document || document.version !== 1 || !document.entries || typeof document.entries !== "object") {
    return createEmptySwarmResponseCache();
  }

  return {
    version: 1,
    updatedAt: typeof document.updatedAt === "string" ? document.updatedAt : new Date(0).toISOString(),
    entries: document.entries
  };
}

function pruneSwarmResponseCache(cache: SwarmResponseCacheDocument): void {
  const entries = Object.entries(cache.entries);
  if (entries.length <= SWARM_RESPONSE_CACHE_MAX_ENTRIES) {
    return;
  }

  entries
    .sort((left, right) => {
      const lastUsedDelta = Date.parse(right[1].lastUsedAt) - Date.parse(left[1].lastUsedAt);
      if (lastUsedDelta !== 0) {
        return lastUsedDelta;
      }
      return right[1].hits - left[1].hits;
    })
    .slice(SWARM_RESPONSE_CACHE_MAX_ENTRIES)
    .forEach(([key]) => {
      delete cache.entries[key];
    });
}

function createEmptySwarmLearning(): SwarmLearningDocument {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    scopes: {}
  };
}

function normalizeSwarmLearning(document: SwarmLearningDocument | undefined): SwarmLearningDocument {
  if (!document || document.version !== 1 || !document.scopes || typeof document.scopes !== "object") {
    return createEmptySwarmLearning();
  }

  return {
    version: 1,
    updatedAt: typeof document.updatedAt === "string" ? document.updatedAt : new Date(0).toISOString(),
    scopes: document.scopes
  };
}

function normalizeLearningScopeKeys(scopePath: string): string[] {
  const normalized = normalizeHintPath(scopePath) || ".";
  if (normalized === ".") {
    return ["."];
  }

  const topLevel = normalized.split("/")[0] ?? normalized;
  return uniqueStrings([normalized, topLevel]);
}

function learningSignalForScope(scopePath: string, learning: SwarmLearningDocument): number {
  const normalizedScope = normalizeHintPath(scopePath) || ".";
  let signal = 0;

  for (const [candidatePath, record] of Object.entries(learning.scopes)) {
    const normalizedCandidate = normalizeHintPath(candidatePath) || ".";

    if (normalizedCandidate === normalizedScope) {
      signal += record.signalScore * 3;
      continue;
    }

    if (normalizedCandidate.startsWith(`${normalizedScope}/`)) {
      signal += Math.max(1, Math.floor(record.signalScore * 1.5));
      continue;
    }

    if (normalizedScope.startsWith(`${normalizedCandidate}/`)) {
      signal += Math.max(1, Math.floor(record.signalScore / 2));
    }
  }

  return signal;
}

function summarizeLearnedScopeBoosts(scopePaths: string[], learning: SwarmLearningDocument): string[] {
  return scopePaths
    .map((scopePath) => ({
      scopePath,
      signal: learningSignalForScope(scopePath, learning)
    }))
    .filter((entry) => entry.signal > 0)
    .sort((left, right) => right.signal - left.signal || left.scopePath.localeCompare(right.scopePath))
    .slice(0, 4)
    .map((entry) => entry.scopePath);
}

function signalScoreForResult(result: SwarmWorkerResult): number {
  if (result.status !== "completed") {
    return 0;
  }

  return result.findings.length * 2 + result.recommendations.length;
}

function updateSwarmLearning(learning: SwarmLearningDocument, workerResults: SwarmWorkerResult[]): void {
  const now = new Date().toISOString();

  for (const result of workerResults) {
    for (const scopeKey of result.scopePaths.flatMap((scopePath) => normalizeLearningScopeKeys(scopePath))) {
      const existing = learning.scopes[scopeKey] ?? {
        signalScore: 0,
        completedRuns: 0,
        failureCount: 0,
        timeoutCount: 0,
        lastSeenAt: now
      };

      if (result.status === "completed") {
        existing.completedRuns += 1;
        existing.signalScore = Math.min(existing.signalScore + signalScoreForResult(result), 60);
      } else if (result.status === "timed_out") {
        existing.timeoutCount += 1;
        existing.signalScore = Math.max(0, existing.signalScore - 1);
      } else {
        existing.failureCount += 1;
        existing.signalScore = Math.max(0, existing.signalScore - 2);
      }

      existing.lastSeenAt = now;
      learning.scopes[scopeKey] = existing;
    }
  }

  learning.updatedAt = now;
}

function createOptimizationStats(): SwarmOptimizationStats {
  return {
    cacheHits: 0,
    cacheMisses: 0,
    cacheWrites: 0,
    scopeMemoryHits: 0,
    scopeMemoryMisses: 0,
    scopeMemoryStale: 0,
    scopeMemoryWrites: 0,
    scopeMemoryReuseCandidates: 0,
    scopeMemoryReductionHints: [],
    derivedTasksQueued: 0,
    derivedTasksSkipped: 0,
    learnedScopeBoosts: []
  };
}

function reusableScopeMemory(records: ScopeMemoryRecord[]): ScopeMemoryRecord[] {
  return records.filter((record) => record.freshness.status === "fresh" && record.coverage?.status === "complete");
}

function scopeMemoryReductionHints(records: ScopeMemoryRecord[]): string[] {
  return reusableScopeMemory(records).map(
    (record) => `${record.scope}: fresh complete memory available; prefer delta analysis and verify only changed evidence.`
  );
}

function isReducibleScopeMemory(record: ScopeMemoryRecord): boolean {
  return record.freshness.status === "fresh" && record.coverage?.status === "complete" && !record.files?.hashTruncated;
}

function reducibleChunkIds(scopeChunks: ScopeChunk[], scopeMemoryByChunk: Map<string, ScopeMemoryRecord[]>): Set<string> {
  return new Set(
    scopeChunks
      .filter((chunk) => {
        const records = scopeMemoryByChunk.get(chunk.chunkId) ?? [];
        const recordScopes = new Set(records.filter(isReducibleScopeMemory).map((record) => record.scope));
        return chunk.scopePaths.length > 0 && chunk.scopePaths.every((scopePath) => recordScopes.has(scopePath));
      })
      .map((chunk) => chunk.chunkId)
  );
}

function splitPlannerTasks(planner: PlannerPayload): {
  initialTasks: SwarmPlanTask[];
  deferredReasoningTasks: SwarmPlanTask[];
} {
  const deferredReasoningTasks = planner.tasks.filter((task) => task.profile === "reasoning");
  const initialTasks = planner.tasks.filter((task) => task.profile !== "reasoning");

  if (deferredReasoningTasks.length === 0 || initialTasks.length === 0) {
    return {
      initialTasks: planner.tasks,
      deferredReasoningTasks: []
    };
  }

  return {
    initialTasks,
    deferredReasoningTasks
  };
}

function createTaskLevels(tasks: SwarmPlanTask[]): SwarmPlanTask[][] {
  const orderedTasks = normalizeTaskDependencies(tasks);
  const completed = new Set<string>();
  const levels: SwarmPlanTask[][] = [];

  while (completed.size < orderedTasks.length) {
    const level = orderedTasks.filter((task) => !completed.has(task.taskId) && (task.dependsOn ?? []).every((dependencyId) => completed.has(dependencyId)));

    if (level.length === 0) {
      levels.push(orderedTasks.filter((task) => !completed.has(task.taskId)));
      break;
    }

    levels.push(level);
    for (const task of level) {
      completed.add(task.taskId);
    }
  }

  return levels;
}

function reserveDerivedReasoningBudget(
  deferredReasoningTasks: SwarmPlanTask[],
  scopeChunks: ScopeChunk[],
  queueBudget: number,
  parallelism: number,
  localBudgetMode: boolean
): number {
  if (deferredReasoningTasks.length === 0 || scopeChunks.length === 0) {
    return 0;
  }

  const potentialTasks = deferredReasoningTasks.length * scopeChunks.length;
  const baselineReserve = localBudgetMode ? 1 : Math.min(Math.max(parallelism, 1), 2);
  const budgetCap = Math.max(1, Math.floor(queueBudget / 3));

  return Math.min(potentialTasks, baselineReserve, budgetCap);
}

function deriveReasoningTasks(
  deferredReasoningTasks: SwarmPlanTask[],
  scopeChunks: ScopeChunk[],
  workerResults: SwarmWorkerResult[],
  reservedBudget: number,
  scopeHints: string[]
): {
  tasks: QueuedSwarmTask[];
  skipped: number;
} {
  if (deferredReasoningTasks.length === 0 || reservedBudget <= 0) {
    return {
      tasks: [],
      skipped: deferredReasoningTasks.length * scopeChunks.length
    };
  }

  const chunkScores = scopeChunks
    .map((chunk, index) => ({
      chunk,
      index,
      hintMatched: chunk.scopePaths.some((scopePath) => matchesScopeHint(scopePath, scopeHints)),
      evidenceScore: workerResults
        .filter((result) => result.chunkId === chunk.chunkId)
        .reduce((total, result) => total + signalScoreForResult(result), 0)
    }))
    .filter((entry) => entry.hintMatched || entry.evidenceScore > 0)
    .sort((left, right) => {
      if (left.hintMatched !== right.hintMatched) {
        return left.hintMatched ? -1 : 1;
      }
      if (right.evidenceScore !== left.evidenceScore) {
        return right.evidenceScore - left.evidenceScore;
      }
      return left.index - right.index;
    });

  const candidates = chunkScores.flatMap((entry) =>
      deferredReasoningTasks.map((task) => ({
        taskId: `${task.taskId}__${entry.chunk.chunkId}`,
        parentTaskId: task.taskId,
        title: `${task.title} [${entry.chunk.label}]`,
        goal: task.goal,
      profile: task.profile,
      deliverable: task.deliverable,
      chunk: entry.chunk,
      attempt: 1
    }))
  );

  const selectedTasks = candidates.slice(0, reservedBudget);
  return {
    tasks: selectedTasks,
    skipped: Math.max(0, deferredReasoningTasks.length * scopeChunks.length - selectedTasks.length)
  };
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

function scoreScopeUnit(stat: ScopeUnitStat, scopeBias: ScopeBias, learning: SwarmLearningDocument): number {
  const sourceLikeBoost = scopeBias === "source-first" ? 90 : 35;
  const testPenalty = scopeBias === "source-first" ? -140 : -25;
  const manifestBonus = scopeBias === "source-first" ? 15 : 30;
  const learningBoost = Math.min(120, learningSignalForScope(stat.entry, learning) * 6);

  return (
    (stat.directory ? 40 : 0) +
    (stat.hidden ? -20 : 20) +
    (stat.sourceLike ? sourceLikeBoost : 0) +
    (stat.testLike ? testPenalty : 0) +
    (stat.sourceFileCount > 0 ? 100 + stat.sourceFileCount * 5 : stat.manifest ? manifestBonus : Math.min(stat.fileCount, 10)) +
    learningBoost +
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
  scopeHints: string[] = [],
  learning: SwarmLearningDocument = createEmptySwarmLearning()
): string[] {
  const stats: ScopeUnitStat[] = uniqueStrings(scopePaths).map((scopePath) => buildScopeUnitStat(context, scopePath));

  return stats
    .sort((left, right) => {
      const leftHint = matchesScopeHint(left.entry, scopeHints);
      const rightHint = matchesScopeHint(right.entry, scopeHints);
      if (leftHint !== rightHint) {
        return rightHint ? 1 : -1;
      }

      const leftScore = scoreScopeUnit(left, scopeBias, learning);
      const rightScore = scoreScopeUnit(right, scopeBias, learning);

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

function prioritizeScopeUnits(
  context: ProjectContext,
  scopeBias: ScopeBias,
  scopeHints: string[] = [],
  learning: SwarmLearningDocument = createEmptySwarmLearning()
): string[] {
  return prioritizeScopePaths(context, context.discovery.structure.topLevelDirectories, scopeBias, scopeHints, learning);
}

function createScopeChunks(
  context: ProjectContext,
  chunkSize: number,
  scopeBias: ScopeBias,
  scopeHints: string[] = [],
  learning: SwarmLearningDocument = createEmptySwarmLearning()
): ScopeChunk[] {
  const directories = prioritizeScopeUnits(context, scopeBias, scopeHints, learning);
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
  queueBudget: number,
  reducedChunkIds: Set<string> = new Set()
): QueuedSwarmTask[][] {
  const maxQueuedTasks = Math.max(Math.min(queueBudget, 64), planner.tasks.length, parallelism);
  const levels = createTaskLevels(planner.tasks);
  const queuedLevels: QueuedSwarmTask[][] = [];
  let queuedCount = 0;

  for (const level of levels) {
    const queuedLevel: QueuedSwarmTask[] = [];

    for (let chunkIndex = 0; chunkIndex < scopeChunks.length; chunkIndex += 1) {
      const chunk = scopeChunks[chunkIndex]!;
      const tasksForChunk = reducedChunkIds.has(chunk.chunkId) ? level.slice(0, 1) : level;
      for (const task of tasksForChunk) {
        queuedLevel.push({
          taskId: `${task.taskId}__${chunk.chunkId}`,
          parentTaskId: task.taskId,
          title: `${task.title} [${chunk.label}]`,
          goal: task.goal,
          profile: task.profile,
          deliverable: task.deliverable,
          chunk,
          attempt: 1
        });
        queuedCount += 1;

        if (queuedCount >= maxQueuedTasks) {
          return queuedLevel.length > 0 ? [...queuedLevels, queuedLevel] : queuedLevels;
        }
      }
    }

    if (queuedLevel.length > 0) {
      queuedLevels.push(queuedLevel);
    }
  }

  return queuedLevels;
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
  scopeHints: string[] = [],
  learning: SwarmLearningDocument = createEmptySwarmLearning()
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

  return prioritizeScopePaths(context, [...children], scopeBias, scopeHints, learning);
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
  learning: SwarmLearningDocument,
  pressure: ResourcePressure,
  localBudgetMode: boolean
): ScopeChunk[] {
  const splitGroupSize = deriveSplitGroupSize(pressure, localBudgetMode);

  if (chunk.scopePaths.length === 1) {
    const childScopePaths = listImmediateChildScopePaths(context, chunk.scopePaths[0]!, scopeBias, scopeHints, learning);
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
    `Testing: ${context.discovery.testing.join(", ") || "Not detected"}`,
    buildMemoryBriefSummary(context, 16)
  ].join("\n");
}

function buildPlannerPrompt(context: ProjectContext, intent: string): AIRouterRequest {
  return {
    task: "intent-routing",
    profile: "planner",
    context: buildRepoSummary(context),
    prompt: [
      "You are planning a bounded model swarm for project-brain.",
      "MEMORY_BRIEF is the priority context. Use it before repository summary details and previous reports.",
      "Do not invent repository facts.",
      "Split the user request into at most 4 small analysis tasks.",
      "Each task must fit one profile: worker, reviewer, or reasoning.",
      "When a task logically needs prior evidence, add dependsOn with the upstream task IDs.",
      "Return JSON only in this shape:",
      '{ "overview": string, "tasks": [{ "taskId": string, "title": string, "goal": string, "profile": "worker|reviewer|reasoning", "deliverable": string, "dependsOn"?: string[] }] }',
      `User intent: ${intent}`
    ].join("\n")
  };
}

function buildWorkerPrompt(
  context: ProjectContext,
  intent: string,
  overview: string,
  task: QueuedSwarmTask,
  scopeMemory: ScopeMemoryRecord[]
): AIRouterRequest {
  return {
    task: taskTypeForProfile(task.profile as ModelProfile),
    profile: task.profile as ModelProfile,
    allowRemote: task.profile === "planner" || task.profile === "synthesizer",
    context: [buildChunkContext(context, task.chunk.scopePaths), renderScopeMemoryForPrompt(scopeMemory)].join("\n\n"),
    prompt: [
      "You are a bounded worker inside a project-brain swarm.",
      "MEMORY_BRIEF is the priority context. Use it first, then scoped files and generated artifacts.",
      "If scope memory is available and fresh, reuse it and only add new evidence or changed facts.",
      "If scope memory coverage is complete, do not restate old facts unless they are needed to explain a delta.",
      "If scope memory is stale, call out changed or missing evidence instead of repeating the old analysis blindly.",
      "Use only the scoped repository context provided.",
      "Do not assume facts that are not in the repository summary.",
      "Every factual claim must be backed by a file path, route, config, manifest, or generated artifact reference.",
      "Use unknowns for missing or unverified relationships.",
      "Return JSON only in this shape:",
      '{ "summary": string, "findings": string[], "recommendations": string[], "verified_facts": string[], "unknowns": string[], "evidence_refs": string[] }',
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

function buildSynthesisPrompt(
  context: ProjectContext,
  intent: string,
  overview: string,
  workerResults: SwarmWorkerResult[]
): AIRouterRequest {
  return {
    task: "report-synthesis",
    profile: "synthesizer",
    context: buildMemoryBriefSummary(context, 24),
    prompt: [
      "You are the synthesizer for a project-brain swarm run.",
      "MEMORY_BRIEF is the priority context. Use it to preserve decisions, corrections, unknowns, and token guidance.",
      "Merge the worker outputs into a concise, decision-oriented result.",
      "Keep facts separate from unknowns. Do not promote worker recommendations into facts unless evidence_refs support them.",
      "Return JSON only in this shape:",
      '{ "headline": string, "summary": string, "verified_facts": string[], "unknowns": string[], "evidence_refs": string[], "priorities": string[], "next_steps": string[] }',
      `User intent: ${intent}`,
      `Swarm overview: ${overview}`,
      "Worker outputs:",
      JSON.stringify(workerResults, null, 2)
    ].join("\n")
  };
}

function selectionIdentity(selection: Pick<ModelSelection, "provider" | "model" | "residency" | "profile">): Pick<
  ModelSelection,
  "provider" | "model" | "residency" | "profile"
> {
  return {
    provider: selection.provider,
    model: selection.model,
    residency: selection.residency,
    profile: selection.profile
  };
}

function recordSwarmCacheEntry(
  cache: SwarmResponseCacheDocument,
  key: string,
  context: ProjectContext,
  request: AIRouterRequest,
  selection: Pick<ModelSelection, "provider" | "model" | "residency" | "profile">,
  response: string
): void {
  const now = new Date().toISOString();
  cache.entries[key] = {
    key,
    request: {
      task: request.task,
      profile: request.profile,
      prompt: canonicalizePromptText(request.prompt) ?? "",
      context: canonicalizePromptText(request.context),
      allowRemote: request.allowRemote
    },
    selection: selectionIdentity(selection),
    response,
    createdAt: now,
    lastUsedAt: now,
    hits: 0
  };
  cache.updatedAt = now;
  pruneSwarmResponseCache(cache);
}

async function askWithSwarmCache(
  context: ProjectContext,
  assistant: SwarmAssistant,
  request: AIRouterRequest,
  selection: ModelSelection,
  cache: SwarmResponseCacheDocument,
  optimization: SwarmOptimizationStats
): Promise<string> {
  const policyRequest = applyTokenPolicy(request);
  const key = buildSwarmCacheKey(context, policyRequest, selectionIdentity(selection));
  const cachedEntry = cache.entries[key];

  if (cachedEntry) {
    cachedEntry.hits += 1;
    cachedEntry.lastUsedAt = new Date().toISOString();
    cache.updatedAt = cachedEntry.lastUsedAt;
    optimization.cacheHits += 1;
    return cachedEntry.response;
  }

  optimization.cacheMisses += 1;
  const response = await assistant.ask(policyRequest);
  recordSwarmCacheEntry(cache, key, context, policyRequest, selection, response);
  optimization.cacheWrites += 1;
  return response;
}

function applySwarmRequestPolicy(request: AIRouterRequest, preset: TokenPreset | undefined): AIRouterRequest {
  return applyPresetPolicy(request, preset ?? "balanced");
}

function renderSwarmReport(
  context: ProjectContext,
  intent: string,
  resilience: SwarmRunResult["resilience"],
  chunking: SwarmRunResult["chunking"],
  parallelism: SwarmRunResult["parallelism"],
  plannerSelection: ModelSelection,
  planner: PlannerPayload,
  optimization: SwarmOptimizationStats,
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
- Cache hits: ${optimization.cacheHits}
- Cache misses: ${optimization.cacheMisses}
- Cache writes: ${optimization.cacheWrites}
- Scope memory hits: ${optimization.scopeMemoryHits}
- Scope memory misses: ${optimization.scopeMemoryMisses}
- Scope memory stale: ${optimization.scopeMemoryStale}
- Scope memory writes: ${optimization.scopeMemoryWrites}
- Scope memory reuse candidates: ${optimization.scopeMemoryReuseCandidates}
- Scope memory reduction hints: ${optimization.scopeMemoryReductionHints.join(", ") || "None"}
- Derived reasoning tasks queued: ${optimization.derivedTasksQueued}
- Derived reasoning tasks skipped: ${optimization.derivedTasksSkipped}
- Learned scope boosts: ${optimization.learnedScopeBoosts.join(", ") || "None"}

## Delegated tasks

${planner.tasks
  .map(
    (task) => `### ${task.title}

- Task ID: ${task.taskId}
- Profile: ${task.profile}
- Depends on: ${task.dependsOn?.join(", ") || "None"}
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

Verified facts:
${renderList(result.verifiedFacts ?? [])}

Unknowns:
${renderList(result.unknowns ?? [])}

Evidence refs:
${renderList(result.evidenceRefs ?? [])}

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

### Verified facts

${renderList(synthesis.verified_facts)}

### Unknowns

${renderList(synthesis.unknowns)}

### Evidence refs

${renderList(synthesis.evidence_refs)}

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
  const optimization = createOptimizationStats();
  const resilience = recommendedResilience(options.taskTimeoutMs, options.maxRetries);
  applyResilienceOverrides(resilience, options, parallelism);
  resilience.localBudgetMode = shouldUseLocalBudgetMode(resilience);
  if (resilience.localBudgetMode && !parallelism.requested) {
    parallelism.selected = Math.min(parallelism.selected, 2);
  }
  if (resilience.localBudgetMode && resilience.adaptiveQueueBudget) {
    resilience.queueBudget = Math.min(resilience.queueBudget, Math.max(parallelism.selected * 2 + 2, 6));
  }

  const swarmResponseCachePath = path.join(context.memoryDir, "swarm", "request_cache.json");
  const swarmLearningPath = path.join(context.memoryDir, "swarm", "learning.json");
  const responseCache = normalizeSwarmResponseCache(await readJsonSafe<SwarmResponseCacheDocument>(swarmResponseCachePath));
  const swarmLearning = normalizeSwarmLearning(await readJsonSafe<SwarmLearningDocument>(swarmLearningPath));
  optimization.learnedScopeBoosts = summarizeLearnedScopeBoosts(context.discovery.structure.topLevelDirectories, swarmLearning);

  const deadline = createDeadline(resilience.runTimeoutMs);
  const plannerRequest: AIRouterRequest = {
    ...applySwarmRequestPolicy(buildPlannerPrompt(context, intent), options.preset),
    allowRemote: !resilience.localBudgetMode,
    timeoutMs: Math.min(resilience.plannerTimeoutMs, remainingBudgetMs(deadline))
  };
  const plannerSelection = await assistant.selectModel(plannerRequest);
  let planner: PlannerPayload;

  try {
    const plannerResponse = await askWithSwarmCache(context, assistant, plannerRequest, plannerSelection, responseCache, optimization);
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

  const scopeChunks = createScopeChunks(context, chunking.selectedChunkSize, chunking.scopeBias, chunking.scopeHints, swarmLearning);
  const scopeMemoryByChunk = new Map<string, ScopeMemoryRecord[]>();
  for (const chunk of scopeChunks) {
    const lookup = await loadScopeMemoryRecords(context, chunk.scopePaths);
    scopeMemoryByChunk.set(chunk.chunkId, lookup.records);
    optimization.scopeMemoryHits += lookup.hits;
    optimization.scopeMemoryMisses += lookup.misses;
    optimization.scopeMemoryStale += lookup.stale;
    optimization.scopeMemoryReuseCandidates += reusableScopeMemory(lookup.records).length;
    optimization.scopeMemoryReductionHints = [
      ...optimization.scopeMemoryReductionHints,
      ...scopeMemoryReductionHints(lookup.records)
    ].slice(0, 12);
  }
  const reducedChunkIds = reducibleChunkIds(scopeChunks, scopeMemoryByChunk);
  if (reducedChunkIds.size > 0) {
    optimization.scopeMemoryReductionHints = [
      ...optimization.scopeMemoryReductionHints,
      `Reduced queued work for ${reducedChunkIds.size} fresh complete scope chunk(s).`
    ].slice(0, 12);
  }
  const { initialTasks, deferredReasoningTasks } = splitPlannerTasks(planner);
  const reservedReasoningBudget =
    deferredReasoningTasks.length > 0 && resilience.queueBudget > initialTasks.length
      ? reserveDerivedReasoningBudget(
          deferredReasoningTasks,
          scopeChunks,
          resilience.queueBudget,
          parallelism.selected,
          resilience.localBudgetMode
        )
      : 0;
  const initialPlanner: PlannerPayload = {
    overview: planner.overview,
    tasks: initialTasks.length > 0 ? initialTasks : planner.tasks
  };
  const initialQueueBudget = reservedReasoningBudget > 0 ? resilience.queueBudget - reservedReasoningBudget : resilience.queueBudget;
  const queuedTaskLevels = createQueuedTasks(initialPlanner, scopeChunks, parallelism.selected, initialQueueBudget, reducedChunkIds);
  chunking.scopeChunks = scopeChunks.length;
  chunking.queuedTasks = queuedTaskLevels.reduce((total, level) => total + level.length, 0);

  const executeQueuedTask = async (task: QueuedSwarmTask): Promise<SwarmTaskOutcome> => {
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
          verifiedFacts: [],
          unknowns: ["The task did not run because the global time budget was exhausted."],
          evidenceRefs: [],
          error: "Run timeout exceeded before task execution."
        }
      };
    }

    const request = buildWorkerPrompt(
      context,
      intent,
      planner.overview,
      {
        ...task
      },
      scopeMemoryByChunk.get(task.chunk.chunkId) ?? []
    );
    const timedRequest: AIRouterRequest = {
      ...applySwarmRequestPolicy(request, options.preset),
      timeoutMs: Math.min(resilience.taskTimeoutMs, remainingMs)
    };
    let selection: ModelSelection | undefined;

    try {
      selection = await assistant.selectModel(timedRequest);
      const response = await askWithSwarmCache(context, assistant, timedRequest, selection, responseCache, optimization);
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
          recommendations: payload.recommendations,
          verifiedFacts: payload.verifiedFacts,
          unknowns: payload.unknowns,
          evidenceRefs: payload.evidenceRefs
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
          swarmLearning,
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
          provider: selection?.provider ?? "ollama",
          model: selection?.model ?? "selection-failed",
          residency: selection?.residency ?? "local",
          summary: timedOut
            ? "The worker exceeded the time budget for this scope chunk."
            : "The worker failed before producing structured output.",
          findings: [],
          recommendations: timedOut
            ? ["Reduce chunk size or increase the worker timeout for this task."]
            : ["Retry the task or inspect the affected scope manually."],
          verifiedFacts: [],
          unknowns: [timedOut ? "The worker exceeded its time budget." : "The worker failed before producing structured output."],
          evidenceRefs: [],
          error: message
        }
      };
    }
  };

  let workerResults = await drainTaskLevelsWithConcurrency(
    queuedTaskLevels,
    parallelism.selected,
    executeQueuedTask
  );

  if (deferredReasoningTasks.length > 0) {
    const derivedReasoningScopeChunks = scopeChunks.filter((chunk) => !reducedChunkIds.has(chunk.chunkId));
    const derivedReasoning = deriveReasoningTasks(
      deferredReasoningTasks,
      derivedReasoningScopeChunks,
      workerResults,
      reservedReasoningBudget,
      chunking.scopeHints
    );
    optimization.derivedTasksQueued = derivedReasoning.tasks.length;
    optimization.derivedTasksSkipped = derivedReasoning.skipped;
    chunking.queuedTasks += derivedReasoning.tasks.length;

    if (derivedReasoning.tasks.length > 0 && remainingBudgetMs(deadline) > 0) {
      const reasoningResults = await drainQueueWithConcurrency(
        [...derivedReasoning.tasks],
        Math.min(parallelism.selected, derivedReasoning.tasks.length),
        executeQueuedTask
      );
      workerResults = [...workerResults, ...reasoningResults];
    }
  }

  resilience.droppedTasks = Math.max(0, totalPotentialQueuedTasks(planner, scopeChunks) - chunking.queuedTasks);

  let synthesis: SynthesisPayload;
  const synthesisRequest: AIRouterRequest = {
    ...applySwarmRequestPolicy(buildSynthesisPrompt(context, intent, planner.overview, workerResults), options.preset),
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
      ],
      verified_facts: workerResults.flatMap((result) => result.verifiedFacts ?? []).slice(0, 12),
      unknowns: ["Synthesis did not run because the global time budget was exhausted."],
      evidence_refs: workerResults.flatMap((result) => result.evidenceRefs ?? []).slice(0, 12)
    };
  } else {
    try {
      const synthesisResponse = await askWithSwarmCache(
        context,
        assistant,
        synthesisRequest,
        synthesisSelection,
        responseCache,
        optimization
      );
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
          ],
          verified_facts: workerResults.flatMap((result) => result.verifiedFacts ?? []).slice(0, 12),
          unknowns: ["Synthesis timed out before producing a full structured merge."],
          evidence_refs: workerResults.flatMap((result) => result.evidenceRefs ?? []).slice(0, 12)
        };
      } else {
        throw error;
      }
    }
  }

  updateSwarmLearning(swarmLearning, workerResults);
  await writeJsonEnsured(swarmResponseCachePath, responseCache);
  await writeJsonEnsured(swarmLearningPath, swarmLearning);
  await appendLearning(context, synthesis.headline);
  for (const nextStep of synthesis.next_steps) {
    await appendLearning(context, nextStep);
  }
  const unknownLoggedAt = new Date().toISOString();
  for (const result of workerResults) {
    for (const unknown of result.unknowns ?? []) {
      await appendError(context, `${unknownLoggedAt} [${result.scopePaths.join(", ") || "."}] ${unknown}`);
    }
  }
  for (const unknown of synthesis.unknowns) {
    await appendError(context, `${unknownLoggedAt} [synthesis] ${unknown}`);
  }

  const reportPath = path.join(context.reportsDir, "swarm_run.md");
  const memoryPath = path.join(context.memoryDir, "swarm", "swarm_run.json");
  optimization.scopeMemoryWrites = await writeScopeMemoryFromSwarmResult(context, {
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
    optimization,
    tasks: planner.tasks,
    workerResults,
    synthesis: {
      provider: synthesisSelection.provider,
      model: synthesisSelection.model,
      residency: synthesisSelection.residency,
      headline: synthesis.headline,
      summary: synthesis.summary,
      priorities: synthesis.priorities,
      nextSteps: synthesis.next_steps,
      verifiedFacts: synthesis.verified_facts,
      unknowns: synthesis.unknowns,
      evidenceRefs: synthesis.evidence_refs
    }
  });

  await writeFileEnsured(
      reportPath,
      renderSwarmReport(
        context,
        intent,
        resilience,
        chunking,
        parallelism,
        plannerSelection,
        planner,
        optimization,
        workerResults,
        synthesisSelection,
        synthesis
      )
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
    optimization,
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
    optimization,
    tasks: planner.tasks,
    workerResults,
    synthesis: {
      provider: synthesisSelection.provider,
      model: synthesisSelection.model,
      residency: synthesisSelection.residency,
      headline: synthesis.headline,
      summary: synthesis.summary,
      priorities: synthesis.priorities,
      nextSteps: synthesis.next_steps,
      verifiedFacts: synthesis.verified_facts,
      unknowns: synthesis.unknowns,
      evidenceRefs: synthesis.evidence_refs
    }
  };
}
