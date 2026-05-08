import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { writeScopeMemoryFromSwarmResult } from "../../memory/scope_store";
import { appendFileEnsured, writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext, SwarmRunResult } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function seedRepo(repoDir: string): Promise<void> {
  await writeFileEnsured(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fact-query-fixture",
        private: true,
        dependencies: {
          commander: "^14.0.1"
        }
      },
      null,
      2
    )
  );
  await writeFileEnsured(path.join(repoDir, "src", "swarm_runtime.ts"), "export function askWithSwarmCache() { return 'cached'; }\n");
}

function staleScopeSwarmResult(context: ProjectContext): SwarmRunResult {
  return {
    engine: "bounded",
    context,
    intent: "inspect beta contract",
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
        taskId: "beta",
        parentTaskId: "beta",
        chunkId: "scope-1",
        attempt: 1,
        status: "completed",
        title: "Inspect beta",
        profile: "worker",
        scopePaths: ["src"],
        provider: "test",
        model: "test",
        residency: "local",
        summary: "done",
        findings: [],
        recommendations: [],
        verifiedFacts: ["beta-contract is enabled"],
        unknowns: [],
        evidenceRefs: ["src/feature.ts"]
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
      verifiedFacts: ["beta-contract is enabled"],
      unknowns: [],
      evidenceRefs: ["src/feature.ts"]
    }
  };
}

describe("fact query", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("queries memory brief and repository fact graph without model calls", async () => {
    const repoDir = await createTempOutputDir("project-brain-fact-query-repo");
    const outputDir = await createTempOutputDir("project-brain-fact-query-output");
    cleanupTargets.push(repoDir, outputDir);

    await seedRepo(repoDir);

    const orchestrator = new ProjectBrainOrchestrator();
    await orchestrator.buildCodeGraph(repoDir, outputDir);
    const context = await orchestrator.initTarget(repoDir, outputDir);
    await appendFileEnsured(
      path.join(context.memoryDir, "DECISIONS.md"),
      "\n- Use swarm cache policy before model execution because cache keys must reflect prompt policy.\n"
    );
    await orchestrator.status(repoDir, outputDir);

    const result = await orchestrator.factQuery(repoDir, outputDir, "swarm cache policy");

    await access(result.reportPath);
    await access(result.memoryPath);
    expect(result.answer).toContain("FOUND");
    expect(result.memoryMatches.some((match) => /swarm cache policy/i.test(match.text))).toBe(true);
    expect(result.nodeMatches.some((match) => match.label.includes("swarm_runtime"))).toBe(true);
    expect(result.evidenceRefs.some((ref) => ref.includes("src/swarm_runtime.ts"))).toBe(true);

    const persisted = JSON.parse(await readFile(result.memoryPath, "utf8")) as { answer?: string };
    expect(persisted.answer).toBe(result.answer);
  });

  it("does not answer from stale scope memory and reports a stale warning", async () => {
    const repoDir = await createTempOutputDir("project-brain-fact-query-stale-repo");
    const outputDir = await createTempOutputDir("project-brain-fact-query-stale-output");
    cleanupTargets.push(repoDir, outputDir);

    await writeFileEnsured(path.join(repoDir, "package.json"), JSON.stringify({ name: "stale-fact-query", private: true }, null, 2));
    await writeFileEnsured(path.join(repoDir, "src", "feature.ts"), "export const feature = true;\n");

    const orchestrator = new ProjectBrainOrchestrator();
    const context = await orchestrator.initTarget(repoDir, outputDir);
    await writeScopeMemoryFromSwarmResult(context, staleScopeSwarmResult(context));
    await writeFileEnsured(path.join(repoDir, "src", "feature.ts"), "export const feature = false;\n");

    const result = await orchestrator.factQuery(repoDir, outputDir, "beta-contract");

    expect(result.scopeMemoryMatches ?? []).toHaveLength(0);
    expect(result.answer).not.toContain("scope-memory=");
    expect(result.unknowns.some((unknown) => /Scope memory for src is stale/.test(unknown))).toBe(true);
  });
});
