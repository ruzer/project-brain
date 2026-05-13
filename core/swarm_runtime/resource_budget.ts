import os from "node:os";

import type { ProjectContext, SwarmRunResult } from "../../shared/types";

type ResourcePressure = SwarmRunResult["parallelism"]["pressure"];
type ScopeBias = SwarmRunResult["chunking"]["scopeBias"];

export interface SwarmBudgetOptions {
  chunkSize?: number;
  taskTimeoutMs?: number;
  maxRetries?: number;
  plannerTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  runTimeoutMs?: number;
  maxQueuedTasks?: number;
  scopeBias?: ScopeBias;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function recommendedChunkSize(
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

export function recommendedParallelism(requested?: number): SwarmRunResult["parallelism"] {
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

export function applyResilienceOverrides(
  resilience: SwarmRunResult["resilience"],
  options: SwarmBudgetOptions,
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

export function shouldUseLocalBudgetMode(resilience: SwarmRunResult["resilience"]): boolean {
  return (
    resilience.runTimeoutMs <= 45_000 ||
    resilience.plannerTimeoutMs <= 8_000 ||
    resilience.synthesisTimeoutMs <= 8_000
  );
}
