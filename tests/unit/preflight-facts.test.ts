import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { preflightFacts } from "../../memory/preflight_facts";
import { writeScopeMemoryFromSwarmResult } from "../../memory/scope_store";
import { fileExists, writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext, SwarmRunResult } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function seedRepo(): Promise<{ repoDir: string; outputDir: string; context: ProjectContext }> {
  const repoDir = await createTempOutputDir("project-brain-preflight-repo");
  const outputDir = await createTempOutputDir("project-brain-preflight-output");
  await writeFileEnsured(path.join(repoDir, "package.json"), JSON.stringify({ name: "preflight-fixture", private: true }, null, 2));
  await writeFileEnsured(path.join(repoDir, "src", "cache.ts"), "export function askWithSwarmCache() { return 'cached'; }\n");
  const orchestrator = new ProjectBrainOrchestrator();
  await orchestrator.buildCodeGraph(repoDir, outputDir);
  const context = await orchestrator.initTarget(repoDir, outputDir);
  await orchestrator.status(repoDir, outputDir);
  return { repoDir, outputDir, context };
}

function scopeResult(context: ProjectContext, fact: string): SwarmRunResult {
  return {
    engine: "bounded",
    context,
    intent: "inspect preflight scope",
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
      failedTasks: 0,
      droppedTasks: 0,
      localBudgetMode: true,
      adaptiveQueueBudget: false
    },
    chunking: {
      selectedChunkSize: 1,
      scopeUnits: 1,
      scopeChunks: 1,
      queuedTasks: 1,
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
    workerResults: [
      {
        taskId: "preflight",
        parentTaskId: "preflight",
        chunkId: "scope-1",
        attempt: 1,
        status: "completed",
        title: "Inspect preflight",
        profile: "worker",
        scopePaths: ["src"],
        provider: "test",
        model: "test",
        residency: "local",
        summary: "done",
        findings: [],
        recommendations: [],
        verifiedFacts: [fact],
        unknowns: [],
        evidenceRefs: ["src/cache.ts"]
      }
    ],
    synthesis: {
      provider: "test",
      model: "test",
      residency: "local",
      headline: "done",
      summary: "done",
      priorities: [],
      nextSteps: [],
      verifiedFacts: [fact],
      unknowns: [],
      evidenceRefs: ["src/cache.ts"]
    }
  };
}

describe("preflight facts", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("reads memory, executive summary, scope memory, and fact graph without writing fact-query artifacts", async () => {
    const { repoDir, outputDir, context } = await seedRepo();
    cleanupTargets.push(repoDir, outputDir);
    await writeScopeMemoryFromSwarmResult(context, scopeResult(context, "preflight-cache-contract is enabled"));

    const result = await preflightFacts(context, "preflight-cache-contract");

    expect(result.factsFound).toBe(true);
    expect(result.confidence).toBe("high");
    expect(result.facts.some((fact) => fact.includes("preflight-cache-contract"))).toBe(true);
    expect(result.freshness.freshScopes).toContain("src");
    expect(result.readiness.hasMemoryBrief).toBe(true);
    expect(result.readiness.hasExecutiveSummary).toBe(true);
    expect(result.readiness.hasFactGraph).toBe(true);
    expect(result.readiness.hasFreshScopeMemory).toBe(true);
    expect(await fileExists(path.join(context.reportsDir, "fact_query.md"))).toBe(false);
    expect(await fileExists(path.join(context.memoryDir, "fact_query", "fact_query.json"))).toBe(false);
  });

  it("ignores stale scope memory and recommends delta analysis", async () => {
    const { repoDir, outputDir, context } = await seedRepo();
    cleanupTargets.push(repoDir, outputDir);
    await writeScopeMemoryFromSwarmResult(context, scopeResult(context, "stale-preflight-fact is enabled"));
    await writeFileEnsured(path.join(repoDir, "src", "cache.ts"), "export function askWithSwarmCache() { return 'changed'; }\n");

    const result = await preflightFacts(context, "stale-preflight-fact", { scopePaths: ["src"] });

    expect(result.facts.some((fact) => fact.includes("stale-preflight-fact"))).toBe(false);
    expect(result.freshness.staleScopes).toContain("src");
    expect(result.staleIgnored.some((entry) => /Scope memory for src is stale/.test(entry))).toBe(true);
    expect(result.recommendedNextAction).toBe("run-swarm-delta");
  });

  it("returns run-code-graph when the repository fact graph is missing", async () => {
    const repoDir = await createTempOutputDir("project-brain-preflight-missing-repo");
    const outputDir = await createTempOutputDir("project-brain-preflight-missing-output");
    cleanupTargets.push(repoDir, outputDir);
    await writeFileEnsured(path.join(repoDir, "package.json"), JSON.stringify({ name: "missing-graph", private: true }, null, 2));
    await writeFileEnsured(path.join(repoDir, "src", "index.ts"), "export const value = 1;\n");
    const orchestrator = new ProjectBrainOrchestrator();
    const context = await orchestrator.initTarget(repoDir, outputDir);
    await orchestrator.status(repoDir, outputDir);

    const result = await preflightFacts(context, "missing graph fact");
    const report = await readFile(result.sources.executiveSummaryPath, "utf8");

    expect(report).toContain("EXECUTIVE_SUMMARY");
    expect(result.recommendedNextAction).toBe("run-code-graph");
    expect(result.unknowns.some((unknown) => /repository_fact_graph\.json is missing/.test(unknown))).toBe(true);
  });
});
