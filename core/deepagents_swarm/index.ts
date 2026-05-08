import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { ChatOllama } from "@langchain/ollama";
import { FilesystemBackend, createDeepAgent, type SubAgent } from "deepagents";
import { tool, toolStrategy } from "langchain";
import { z } from "zod";

import { buildRepoSummary } from "../../agents/ai-support";
import { ensureDir, readTextSafe, toPosixPath, walkDirectory, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectContext, SwarmPlanTask, SwarmRunResult, SwarmWorkerResult } from "../../shared/types";
import type { ModelInventory } from "../ai_router/router";

interface DeepAgentsAssistant {
  listModels?: () => Promise<ModelInventory>;
}

interface DeepAgentsSwarmOptions {
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

const SWARM_TASK_PROFILES = ["worker", "reviewer", "reasoning", "planner", "synthesizer"] as const;
const INSPECTABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
  ".sh",
  ".sql"
]);
const INSPECTABLE_BASENAMES = new Set([
  "Dockerfile",
  "package.json",
  "tsconfig.json",
  "README.md",
  "Makefile",
  ".env.example"
]);

const subagentSummarySchema = z.object({
  title: z.string(),
  profile: z.enum(SWARM_TASK_PROFILES).default("reasoning"),
  summary: z.string(),
  findings: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([])
});

const deepAgentsSwarmResponseSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  findings: z.array(z.string()).default([]),
  priorities: z.array(z.string()).default([]),
  next_steps: z.array(z.string()).default([]),
  task_summaries: z.array(subagentSummarySchema).default([])
});

type DeepAgentsSwarmResponse = z.infer<typeof deepAgentsSwarmResponseSchema>;

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function isInspectableFile(filePath: string): boolean {
  const baseName = path.basename(filePath);
  return INSPECTABLE_BASENAMES.has(baseName) || INSPECTABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveWithinRoot(rootPath: string, requestedPath: string): string {
  const normalizedRequest = requestedPath.trim() || ".";
  const resolvedRoot = path.resolve(rootPath);
  const candidate = path.resolve(rootPath, normalizedRequest);

  if (candidate !== resolvedRoot && !candidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes the allowed root: ${requestedPath}`);
  }

  return candidate;
}

function relativeFrom(rootPath: string, absolutePath: string): string {
  return toPosixPath(path.relative(rootPath, absolutePath) || ".");
}

function clampLineWindow(startLine: number, endLine: number, maxSpan = 250): { startLine: number; endLine: number } {
  const safeStart = Number.isFinite(startLine) ? Math.max(1, Math.trunc(startLine)) : 1;
  const safeEnd = Number.isFinite(endLine) ? Math.max(safeStart, Math.trunc(endLine)) : safeStart + maxSpan - 1;

  if (safeEnd - safeStart + 1 > maxSpan) {
    return {
      startLine: safeStart,
      endLine: safeStart + maxSpan - 1
    };
  }

  return {
    startLine: safeStart,
    endLine: safeEnd
  };
}

function excerptLines(content: string, startLine: number, endLine: number): string {
  const { startLine: boundedStart, endLine: boundedEnd } = clampLineWindow(startLine, endLine);
  const lines = content.split(/\r?\n/);
  const selected = lines.slice(boundedStart - 1, boundedEnd);

  if (selected.length === 0) {
    return "No content available in the requested line range.";
  }

  return selected.map((line, index) => `${boundedStart + index}: ${line}`).join("\n");
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

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (!entry || typeof entry !== "object") {
        return "";
      }

      const block = entry as Record<string, unknown>;
      if (typeof block.text === "string") {
        return block.text;
      }
      if (typeof block.content === "string") {
        return block.content;
      }

      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeDeepAgentsResponse(raw: unknown, intent: string): DeepAgentsSwarmResponse {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const record = raw as Record<string, unknown>;
    const structured = record.structuredResponse;
    const structuredParsed = deepAgentsSwarmResponseSchema.safeParse(structured);
    if (structuredParsed.success) {
      return structuredParsed.data;
    }

    if (Array.isArray(record.messages) && record.messages.length > 0) {
      const lastMessage = record.messages[record.messages.length - 1];
      if (lastMessage && typeof lastMessage === "object") {
        const text = extractMessageText((lastMessage as Record<string, unknown>).content);
        const extracted = text ? extractJsonObject(text) : undefined;
        const extractedParsed = deepAgentsSwarmResponseSchema.safeParse(extracted);
        if (extractedParsed.success) {
          return extractedParsed.data;
        }
      }
    }
  }

  return {
    headline: `The deepagents swarm completed a partial review for: ${intent}`,
    summary: "Deep Agents returned an unstructured answer, so project-brain preserved a conservative fallback summary.",
    findings: ["The experimental deepagents engine did not return the expected structured payload."],
    priorities: ["Tighten the response schema or system prompt if this engine is promoted."],
    next_steps: ["Inspect the deepagents workspace artifacts and rerun with a narrower intent."],
    task_summaries: []
  };
}

function buildRawResultPreview(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const record = raw as Record<string, unknown>;
  const preview: Record<string, unknown> = {};

  if (record.structuredResponse && typeof record.structuredResponse === "object") {
    preview.structuredResponse = record.structuredResponse;
  }

  if (Array.isArray(record.messages)) {
    preview.messageCount = record.messages.length;
    const lastMessage = record.messages[record.messages.length - 1];
    if (lastMessage && typeof lastMessage === "object") {
      const finalMessage = extractMessageText((lastMessage as Record<string, unknown>).content).trim();
      if (finalMessage) {
        preview.finalMessage = finalMessage.slice(0, 4000);
      }
    }
  }

  return Object.keys(preview).length > 0 ? preview : undefined;
}

function derivePressure(cpuCount: number, loadAverage1m: number, freeMemoryMb: number): SwarmRunResult["parallelism"]["pressure"] {
  if (loadAverage1m >= Math.max(cpuCount * 0.75, 6) || freeMemoryMb < 1024) {
    return "high";
  }

  if (loadAverage1m >= Math.max(cpuCount * 0.45, 3) || freeMemoryMb < 2048) {
    return "medium";
  }

  return "low";
}

function resolveScopeHints(intent: string): string[] {
  const matches = intent.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g) ?? [];
  return unique(matches.map((match) => match.replace(/^\.\/+/, "").trim())).slice(0, 5);
}

function defaultTaskPlan(intent: string): SwarmPlanTask[] {
  return [
    {
      taskId: "deep-map",
      title: "Map repository shape",
      goal: `Identify stack, boundaries, and hotspots for: ${intent}`,
      profile: "reviewer",
      deliverable: "Repo map with relevant hotspots."
    },
    {
      taskId: "deep-risk-review",
      title: "Review critical risks",
      goal: "Surface grounded architectural, testing, and delivery risks from repo evidence.",
      profile: "reasoning",
      deliverable: "Evidence-backed risk review."
    },
    {
      taskId: "deep-priorities",
      title: "Prioritize next steps",
      goal: "Turn the findings into a short, high-signal action plan.",
      profile: "planner",
      deliverable: "Ordered next steps."
    }
  ];
}

function renderDeepAgentsReport(
  context: ProjectContext,
  intent: string,
  workspacePath: string,
  result: DeepAgentsSwarmResponse,
  tasks: SwarmPlanTask[],
  workerResults: SwarmWorkerResult[],
  model: {
    provider: string;
    model: string;
    residency: string;
  }
): string {
  return `# DeepAgents Swarm Run

- Engine: deepagents
- Repository: ${context.repoName}
- Intent: ${intent}
- Model: ${model.model}
- Provider: ${model.provider}
- Residency: ${model.residency}
- Workspace: ${workspacePath}

## Headline

${result.headline}

## Summary

${result.summary}

## Findings

${renderList(result.findings)}

## Priorities

${renderList(result.priorities)}

## Next Steps

${renderList(result.next_steps)}

## Planned Tasks

${tasks
  .map((task) => `- ${task.title} [${task.profile}] -> ${task.deliverable}`)
  .join("\n")}

## Task Outputs

${workerResults
  .map(
    (worker) => `### ${worker.title}

- Profile: ${worker.profile}
- Status: ${worker.status}
- Model: ${worker.model}
- Scope: ${worker.scopePaths.join(", ") || "."}
- Summary: ${worker.summary}

Findings:
${renderList(worker.findings)}

Recommendations:
${renderList(worker.recommendations)}`
  )
  .join("\n\n")}
`;
}

function createRepoTools(context: ProjectContext) {
  const repoRoot = context.targetPath;
  const outputRoot = context.outputPath;

  const repoOverview = tool(
    async () =>
      [
        buildRepoSummary(context),
        `Target path: ${repoRoot}`,
        `Output path: ${outputRoot}`,
        `Top-level directories: ${context.discovery.structure.topLevelDirectories.join(", ") || "None"}`,
        `Sample files: ${context.discovery.structure.sampleFiles.slice(0, 20).join(", ") || "None"}`
      ].join("\n"),
    {
      name: "get_repo_overview",
      description: "Return a compact overview of the repository, stack, and discovered hotspots.",
      schema: z.object({})
    }
  );

  const repoDirectory = tool(
    async ({ dir = ".", maxEntries = 80 }: { dir?: string; maxEntries?: number }) => {
      const absoluteDir = resolveWithinRoot(repoRoot, dir);
      const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

      return entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .slice(0, maxEntries)
        .map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${toPosixPath(path.join(dir, entry.name))}`)
        .join("\n") || "Directory is empty.";
    },
    {
      name: "list_repo_directory",
      description: "List files and directories under a repository path. Paths are relative to the repo root.",
      schema: z.object({
        dir: z.string().optional().default("."),
        maxEntries: z.number().int().min(1).max(200).optional().default(80)
      })
    }
  );

  const repoFile = tool(
    async ({
      filePath,
      startLine = 1,
      endLine = 200
    }: {
      filePath: string;
      startLine?: number;
      endLine?: number;
    }) => {
      const absolutePath = resolveWithinRoot(repoRoot, filePath);
      const content = await readTextSafe(absolutePath);
      if (!content) {
        return `No readable content found for ${filePath}.`;
      }

      return excerptLines(content, startLine, endLine);
    },
    {
      name: "read_repo_file",
      description: "Read a file from the repository. Use relative paths from the repo root and bounded line ranges.",
      schema: z.object({
        filePath: z.string(),
        startLine: z.number().int().min(1).optional().default(1),
        endLine: z.number().int().min(1).optional().default(200)
      })
    }
  );

  const repoSearch = tool(
    async ({
      query,
      scope = ".",
      maxResults = 40
    }: {
      query: string;
      scope?: string;
      maxResults?: number;
    }) => {
      const absoluteScope = resolveWithinRoot(repoRoot, scope);
      const stats = await fs.stat(absoluteScope);
      const candidates = stats.isDirectory()
        ? await walkDirectory(absoluteScope, 1500)
        : [path.basename(absoluteScope)];
      const results: string[] = [];
      const normalizedQuery = query.toLowerCase();

      for (const relativePath of candidates) {
        if (results.length >= maxResults) {
          break;
        }

        const absolutePath = stats.isDirectory() ? path.join(absoluteScope, relativePath) : absoluteScope;
        const repoRelativePath = stats.isDirectory()
          ? relativeFrom(repoRoot, absolutePath)
          : relativeFrom(repoRoot, absoluteScope);

        if (!isInspectableFile(repoRelativePath)) {
          continue;
        }

        const content = await readTextSafe(absolutePath);
        if (!content) {
          continue;
        }

        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (lines[index].toLowerCase().includes(normalizedQuery)) {
            results.push(`${repoRelativePath}:${index + 1}: ${lines[index].trim()}`);
            if (results.length >= maxResults) {
              break;
            }
          }
        }
      }

      return results.length > 0 ? results.join("\n") : `No matches found for "${query}".`;
    },
    {
      name: "search_repo",
      description: "Search for a literal string across repository files. Use this to locate symbols, configs, and implementation hotspots.",
      schema: z.object({
        query: z.string(),
        scope: z.string().optional().default("."),
        maxResults: z.number().int().min(1).max(100).optional().default(40)
      })
    }
  );

  const outputArtifact = tool(
    async ({
      filePath,
      startLine = 1,
      endLine = 200
    }: {
      filePath: string;
      startLine?: number;
      endLine?: number;
    }) => {
      const absolutePath = resolveWithinRoot(outputRoot, filePath);
      const content = await readTextSafe(absolutePath);
      if (!content) {
        return `No readable artifact found for ${filePath}.`;
      }

      return excerptLines(content, startLine, endLine);
    },
    {
      name: "read_output_artifact",
      description: "Read a generated project-brain artifact from the output directory, such as reports or AI_CONTEXT files.",
      schema: z.object({
        filePath: z.string(),
        startLine: z.number().int().min(1).optional().default(1),
        endLine: z.number().int().min(1).optional().default(200)
      })
    }
  );

  return [repoOverview, repoDirectory, repoFile, repoSearch, outputArtifact];
}

function buildSubagents(): SubAgent[] {
  return [
    {
      name: "repo_mapper",
      description: "Maps stack, directory boundaries, entrypoints, and likely hotspots.",
      systemPrompt:
        "Map the repository shape with evidence. Focus on stack, boundaries, entrypoints, and the most relevant code areas tied to the user intent.",
      responseFormat: toolStrategy(subagentSummarySchema)
    },
    {
      name: "risk_reviewer",
      description: "Reviews architecture, testing, operability, and delivery risks grounded in repo evidence.",
      systemPrompt:
        "Review critical technical risks. Prioritize grounded findings over speculation and tie every concern to repo evidence.",
      responseFormat: toolStrategy(subagentSummarySchema)
    },
    {
      name: "delivery_planner",
      description: "Turns evidence into a short, prioritized implementation plan.",
      systemPrompt:
        "Convert the mapped evidence into a pragmatic, short, prioritized next-step plan. Prefer small, high-leverage changes.",
      responseFormat: toolStrategy(subagentSummarySchema)
    }
  ];
}

function resolveModelSelection(inventory: ModelInventory): {
  provider: string;
  model: string;
  residency: string;
  offlineCapable: boolean;
} {
  const candidates = unique([
    inventory.resolvedProfiles.planner,
    inventory.resolvedProfiles.reasoning,
    inventory.resolvedProfiles.reviewer,
    inventory.localConfigured,
    inventory.fallbackConfigured
  ]);

  for (const candidate of candidates) {
    const descriptor = inventory.availableModels.find((model) => model.name === candidate);
    if (descriptor) {
      return {
        provider: "ollama",
        model: descriptor.name,
        residency: descriptor.residency,
        offlineCapable: descriptor.offlineCapable
      };
    }
  }

  const fallback = inventory.availableModels[0];
  if (fallback) {
    return {
      provider: "ollama",
      model: fallback.name,
      residency: fallback.residency,
      offlineCapable: fallback.offlineCapable
    };
  }

  throw new Error("Deep Agents swarm requires at least one Ollama model. Run `project-brain models` to verify availability.");
}

export async function runDeepAgentsSwarm(
  context: ProjectContext,
  intent: string,
  assistant: DeepAgentsAssistant,
  options: DeepAgentsSwarmOptions = {}
): Promise<SwarmRunResult> {
  if (!assistant.listModels) {
    throw new Error("Deep Agents swarm requires model inventory support from the AI router.");
  }

  const inventory = await assistant.listModels();
  const modelSelection = resolveModelSelection(inventory);
  const workspacePath = path.join(context.memoryDir, "swarm", "deepagents_workspace");
  const reportPath = path.join(context.reportsDir, "swarm_run.md");
  const memoryPath = path.join(context.memoryDir, "swarm", "swarm_run.json");
  const scopeHints = resolveScopeHints(intent);
  const cpuCount = Math.max(1, os.cpus().length);
  const loadAverage1m = os.loadavg()[0] ?? 0;
  const freeMemoryMb = Math.round(os.freemem() / (1024 * 1024));
  const totalMemoryMb = Math.round(os.totalmem() / (1024 * 1024));
  const runTimeoutMs = options.runTimeoutMs ?? 90_000;

  await ensureDir(workspacePath);

  const backend = new FilesystemBackend({
    rootDir: workspacePath,
    virtualMode: true,
    maxFileSizeMb: 2
  });

  const model = new ChatOllama({
    model: modelSelection.model,
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    temperature: 0,
    think: false
  });

  const agent = createDeepAgent({
    name: "project-brain-deepagents-swarm",
    model,
    backend,
    tools: createRepoTools(context),
    subagents: buildSubagents(),
    responseFormat: toolStrategy(deepAgentsSwarmResponseSchema),
    systemPrompt: [
      "You are the experimental Deep Agents swarm engine for project-brain.",
      "Your job is to inspect a repository in read-only mode, keep working notes in the isolated workspace, delegate when useful, and return grounded implementation guidance.",
      "Constraints:",
      "- Never modify files inside the target repository.",
      "- Never propose automatic application of patches.",
      "- Use repository tools to inspect code and generated project-brain artifacts.",
      "- Use built-in filesystem tools only for scratch notes inside the isolated deepagents workspace.",
      "- Prefer evidence over speculation and keep recommendations concrete.",
      "- For non-trivial tasks, use write_todos and delegate to at least one specialist subagent before finalizing.",
      scopeHints.length > 0 ? `Scope hints from the user intent: ${scopeHints.join(", ")}` : "No explicit scope hints were present in the user intent.",
      `Repository summary:\n${buildRepoSummary(context)}`
    ].join("\n")
  });

  let normalized: DeepAgentsSwarmResponse;
  let rawResult: unknown;
  let runTimedOut = false;

  try {
    rawResult = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: [
              `Intent: ${intent}`,
              "",
              "Analyze this repository the way project-brain needs:",
              "- map the repo shape and the most relevant areas",
              "- surface concrete technical risks tied to evidence",
              "- prioritize a short set of high-leverage next steps",
              "",
              "Return structured JSON only."
            ].join("\n")
          }
        ]
      },
      {
        signal: AbortSignal.timeout(runTimeoutMs)
      }
    );

    normalized = normalizeDeepAgentsResponse(rawResult, intent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/abort|timeout/i.test(message)) {
      throw error;
    }

    runTimedOut = true;
    normalized = {
      headline: `The deepagents swarm hit its time budget for: ${intent}`,
      summary: "The experimental deepagents run timed out before producing a complete structured result.",
      findings: ["The deepagents engine exceeded the configured global timeout."],
      priorities: ["Tighten the intent or increase the run timeout for deep analysis."],
      next_steps: ["Retry with a narrower scope or a larger timeout budget."],
      task_summaries: []
    };
  }

  const tasks = normalized.task_summaries.length > 0
    ? normalized.task_summaries.map((summary, index): SwarmPlanTask => ({
        taskId: `deepagents-task-${index + 1}`,
        title: summary.title,
        goal: summary.summary,
        profile: summary.profile,
        deliverable: summary.recommendations[0] ?? "Grounded repo analysis."
      }))
    : defaultTaskPlan(intent);

  const workerResults = (normalized.task_summaries.length > 0 ? normalized.task_summaries : [
    {
      title: "Deep Agents synthesis",
      profile: "reasoning" as const,
      summary: normalized.summary,
      findings: normalized.findings,
      recommendations: [...normalized.priorities, ...normalized.next_steps]
    }
  ]).map((summary, index): SwarmWorkerResult => ({
    taskId: `deepagents-task-${index + 1}`,
    parentTaskId: `deepagents-task-${index + 1}`,
    chunkId: "deepagents-workspace",
    attempt: 1,
    status: runTimedOut ? "timed_out" : "completed",
    title: summary.title,
    profile: summary.profile,
    scopePaths: scopeHints.length > 0 ? scopeHints : ["."],
    provider: modelSelection.provider,
    model: modelSelection.model,
    residency: modelSelection.residency,
    summary: summary.summary,
    findings: summary.findings,
    recommendations: summary.recommendations,
    error: runTimedOut ? "Deep Agents run timeout exceeded." : undefined
  }));

  const resilience: SwarmRunResult["resilience"] = {
    runTimeoutMs,
    requestedRunTimeoutMs: options.runTimeoutMs,
    plannerTimeoutMs: options.plannerTimeoutMs ?? runTimeoutMs,
    requestedPlannerTimeoutMs: options.plannerTimeoutMs,
    synthesisTimeoutMs: options.synthesisTimeoutMs ?? runTimeoutMs,
    requestedSynthesisTimeoutMs: options.synthesisTimeoutMs,
    taskTimeoutMs: options.taskTimeoutMs ?? runTimeoutMs,
    requestedTaskTimeoutMs: options.taskTimeoutMs,
    maxRetries: options.maxRetries ?? 0,
    queueBudget: options.maxQueuedTasks ?? tasks.length,
    requestedQueueBudget: options.maxQueuedTasks,
    plannerTimedOut: false,
    synthesisTimedOut: false,
    runTimedOut,
    timedOutTasks: runTimedOut ? workerResults.length : 0,
    retriedTasks: 0,
    splitTasks: 0,
    failedTasks: 0,
    droppedTasks: 0,
    localBudgetMode: modelSelection.offlineCapable,
    adaptiveQueueBudget: false
  };

  const chunking: SwarmRunResult["chunking"] = {
    selectedChunkSize: options.chunkSize ?? 1,
    requestedChunkSize: options.chunkSize,
    scopeUnits: Math.max(context.discovery.structure.topLevelDirectories.length, 1),
    scopeChunks: 1,
    queuedTasks: tasks.length,
    queueStrategy: "round-robin",
    scopeBias: options.scopeBias ?? "source-first",
    scopeHints
  };

  const parallelism: SwarmRunResult["parallelism"] = {
    selected: 1,
    requested: options.parallelism,
    cpuCount,
    loadAverage1m,
    freeMemoryMb,
    totalMemoryMb,
    pressure: derivePressure(cpuCount, loadAverage1m, freeMemoryMb)
  };

  await writeFileEnsured(
    reportPath,
    renderDeepAgentsReport(context, intent, workspacePath, normalized, tasks, workerResults, modelSelection)
  );
  await writeJsonEnsured(memoryPath, {
    engine: "deepagents",
    repoName: context.repoName,
    intent,
    workspacePath,
    model: modelSelection,
    resilience,
    chunking,
    parallelism,
    structuredResponse: normalized,
    resultPreview: buildRawResultPreview(rawResult)
  });

  return {
    engine: "deepagents",
    context,
    intent,
    reportPath,
    memoryPath,
    resilience,
    chunking,
    parallelism,
    planner: {
      provider: modelSelection.provider,
      model: modelSelection.model,
      residency: modelSelection.residency,
      overview: normalized.summary
    },
    tasks,
    workerResults,
    synthesis: {
      provider: modelSelection.provider,
      model: modelSelection.model,
      residency: modelSelection.residency,
      headline: normalized.headline,
      summary: normalized.summary,
      priorities: unique([...normalized.priorities, ...normalized.findings]).slice(0, 8),
      nextSteps: normalized.next_steps
    }
  };
}
