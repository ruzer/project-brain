import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiscoveryEngine } from "../../core/discovery_engine";
import { initializeProjectMemory } from "../../memory/context_store";
import { writeExecutiveSummaryArtifacts } from "../../memory/executive_summary";
import { writeScopeMemoryFromSwarmResult } from "../../memory/scope_store";
import { writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext, SwarmRunResult, SwarmWorkerResult } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function createContext(prefix: string): Promise<{ repoDir: string; outputDir: string; context: ProjectContext }> {
  const repoDir = await createTempOutputDir(`${prefix}-repo`);
  const outputDir = await createTempOutputDir(`${prefix}-output`);
  await writeFileEnsured(path.join(repoDir, "package.json"), JSON.stringify({ name: prefix, private: true }, null, 2));
  await writeFileEnsured(path.join(repoDir, "core", "a.ts"), "export const coreValue = 1;\n");
  await writeFileEnsured(path.join(repoDir, "src", "b.ts"), "export const srcValue = 1;\n");
  const discovery = await new DiscoveryEngine().analyze(repoDir);
  const memory = await initializeProjectMemory(outputDir, discovery);
  return {
    repoDir,
    outputDir,
    context: {
      repoName: discovery.repoName,
      targetPath: discovery.targetPath,
      outputPath: outputDir,
      scannedAt: discovery.scannedAt,
      discovery,
      ...memory
    }
  };
}

function worker(scope: string, status: SwarmWorkerResult["status"]): SwarmWorkerResult {
  return {
    taskId: `${scope}-${status}`,
    parentTaskId: "inspect",
    chunkId: scope,
    attempt: 1,
    status,
    title: `Inspect ${scope}`,
    profile: "worker",
    scopePaths: [scope],
    provider: "test",
    model: "test",
    residency: "local",
    summary: status,
    findings: [],
    recommendations: [`Review ${scope}`],
    verifiedFacts: status === "completed" ? [`${scope} fact`] : [],
    unknowns: status === "completed" ? [] : [`${scope} unresolved`],
    evidenceRefs: [`${scope}/${scope === "core" ? "a" : "b"}.ts`]
  };
}

function swarmResult(context: ProjectContext): SwarmRunResult {
  return {
    engine: "bounded",
    context,
    intent: "summarize scopes",
    reportPath: path.join(context.reportsDir, "swarm_run.md"),
    memoryPath: path.join(context.memoryDir, "swarm", "swarm_run.json"),
    resilience: {
      runTimeoutMs: 1,
      plannerTimeoutMs: 1,
      synthesisTimeoutMs: 1,
      taskTimeoutMs: 1,
      maxRetries: 0,
      queueBudget: 1,
      plannerTimedOut: false,
      synthesisTimedOut: false,
      runTimedOut: false,
      timedOutTasks: 0,
      retriedTasks: 0,
      splitTasks: 0,
      failedTasks: 1,
      droppedTasks: 0,
      localBudgetMode: true,
      adaptiveQueueBudget: false
    },
    chunking: {
      selectedChunkSize: 1,
      scopeUnits: 2,
      scopeChunks: 2,
      queuedTasks: 3,
      queueStrategy: "round-robin",
      scopeBias: "balanced",
      scopeHints: []
    },
    parallelism: {
      selected: 1,
      cpuCount: 1,
      loadAverage1m: 0,
      freeMemoryMb: 1,
      totalMemoryMb: 1,
      pressure: "low"
    },
    planner: {
      provider: "test",
      model: "test",
      residency: "local",
      overview: "test"
    },
    tasks: [],
    workerResults: [worker("core", "completed"), worker("src", "completed"), worker("src", "failed")],
    synthesis: {
      provider: "test",
      model: "test",
      residency: "local",
      headline: "Scope summary",
      summary: "Summary",
      priorities: [],
      nextSteps: [],
      verifiedFacts: ["core fact", "src fact"],
      unknowns: ["src unresolved"],
      evidenceRefs: ["core/a.ts", "src/b.ts"]
    }
  };
}

describe("executive summary", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("summarizes real scope memory records with freshness, coverage, and evidence counts", async () => {
    const { repoDir, outputDir, context } = await createContext("project-brain-executive-summary");
    cleanupTargets.push(repoDir, outputDir);

    await writeScopeMemoryFromSwarmResult(context, swarmResult(context));
    await writeFileEnsured(path.join(repoDir, "src", "b.ts"), "export const srcValue = 2;\n");

    const summary = await writeExecutiveSummaryArtifacts(context);

    expect(summary.status.scopeCount).toBe(2);
    expect(summary.status.completeFreshScopes).toBe(1);
    expect(summary.status.staleScopes).toBe(1);
    expect(summary.status.partialScopes).toBe(1);
    expect(summary.scopeStatuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "core", freshness: "fresh", coverage: "complete" }),
        expect.objectContaining({ scope: "src", freshness: "stale", coverage: "partial" })
      ])
    );

    const report = await readFile(summary.reportPath, "utf8");
    expect(report).toContain("| core | fresh | complete |");
    expect(report).toContain("| src | stale | partial |");
  });
});
