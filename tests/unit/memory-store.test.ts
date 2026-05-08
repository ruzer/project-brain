import { access, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiscoveryEngine } from "../../core/discovery_engine";
import { initializeProjectMemory, writeDiscoveryArtifacts } from "../../memory/context_store";
import { loadScopeMemoryRecords, scopeMemoryPath, writeScopeMemoryFromSwarmResult } from "../../memory/scope_store";
import { writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext, SwarmRunResult } from "../../shared/types";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

async function createScopedContext(prefix: string, files: Record<string, string>): Promise<{ repoDir: string; outputDir: string; context: ProjectContext }> {
  const repoDir = await createTempOutputDir(`${prefix}-repo`);
  const outputDir = await createTempOutputDir(`${prefix}-output`);
  await writeFileEnsured(path.join(repoDir, "package.json"), JSON.stringify({ name: prefix, private: true }, null, 2));
  await Promise.all(Object.entries(files).map(([filePath, content]) => writeFileEnsured(path.join(repoDir, filePath), content)));
  const discovery = await new DiscoveryEngine().analyze(repoDir);
  const memory = await initializeProjectMemory(outputDir, discovery);
  const context: ProjectContext = {
    repoName: discovery.repoName,
    targetPath: discovery.targetPath,
    outputPath: outputDir,
    scannedAt: discovery.scannedAt,
    discovery,
    ...memory
  };
  return { repoDir, outputDir, context };
}

function swarmResultForScope(context: ProjectContext, scope: string, fact = "scope fact is enabled"): SwarmRunResult {
  return {
    engine: "bounded",
    context,
    intent: `inspect ${scope}`,
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
        taskId: `task-${scope}`,
        parentTaskId: "task",
        chunkId: "scope-1",
        attempt: 1,
        status: "completed",
        title: "Inspect scope",
        profile: "worker",
        scopePaths: [scope],
        provider: "test",
        model: "test",
        residency: "local",
        summary: "done",
        findings: [],
        recommendations: ["keep scope memory fresh"],
        verifiedFacts: [fact],
        unknowns: [],
        evidenceRefs: [`${scope}/a.ts`]
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
      evidenceRefs: [`${scope}/a.ts`]
    }
  };
}

describe("Memory store", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("initializes memory directories and writes discovery artifacts", async () => {
    const outputDir = await createTempOutputDir("project-brain-memory");
    cleanupTargets.push(outputDir);
    const discovery = await new DiscoveryEngine().analyze(fixtureRepoPath);
    const memory = await initializeProjectMemory(outputDir, discovery);

    await writeDiscoveryArtifacts(memory.memoryDir, discovery, [
      { path: "openapi.yaml", title: "Sample Repo API", version: "1.0.0" }
    ]);

    await access(path.join(memory.memoryDir, "AGENTS.md"));
    await access(path.join(memory.memoryDir, "PROJECT_MODEL.md"));
    await access(memory.learningDir);

    const projectModel = await readFile(path.join(memory.memoryDir, "PROJECT_MODEL.md"), "utf8");
    expect(projectModel).toContain("Project: sample-repo");
    expect(projectModel).toContain("Express");
  });

  it("marks scope memory fresh then stale when a hashed file changes", async () => {
    const { repoDir, outputDir, context } = await createScopedContext("project-brain-scope-stale", {
      "src/a.ts": "export const value = 1;\n"
    });
    cleanupTargets.push(repoDir, outputDir);

    await writeScopeMemoryFromSwarmResult(context, swarmResultForScope(context, "src"));
    const fresh = await loadScopeMemoryRecords(context, ["src"]);
    expect(fresh.hits).toBe(1);
    expect(fresh.stale).toBe(0);
    expect(fresh.records[0]?.freshness.status).toBe("fresh");

    await writeFileEnsured(path.join(repoDir, "src/a.ts"), "export const value = 2;\n");
    const stale = await loadScopeMemoryRecords(context, ["src"]);
    expect(stale.hits).toBe(0);
    expect(stale.stale).toBe(1);
    expect(stale.records[0]?.freshness.changedFiles).toContain("src/a.ts");
  });

  it("marks scope memory stale when a previously hashed file is deleted", async () => {
    const { repoDir, outputDir, context } = await createScopedContext("project-brain-scope-deleted", {
      "src/a.ts": "export const value = 1;\n"
    });
    cleanupTargets.push(repoDir, outputDir);

    await writeScopeMemoryFromSwarmResult(context, swarmResultForScope(context, "src"));
    await unlink(path.join(repoDir, "src/a.ts"));

    const stale = await loadScopeMemoryRecords(context, ["src"]);
    expect(stale.stale).toBe(1);
    expect(stale.records[0]?.freshness.missingFiles).toContain("src/a.ts");
  });

  it("caps scope hashing at 80 files and records hash truncation", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 81 }, (_, index) => [`src/file-${String(index).padStart(3, "0")}.ts`, `export const value${index} = ${index};\n`])
    );
    const { repoDir, outputDir, context } = await createScopedContext("project-brain-scope-hash-cap", files);
    cleanupTargets.push(repoDir, outputDir);

    await writeScopeMemoryFromSwarmResult(context, swarmResultForScope(context, "src"));
    const record = JSON.parse(await readFile(scopeMemoryPath(context, "src"), "utf8")) as {
      files: { count: number; totalCount: number; hashTruncated: boolean; hashed: unknown[] };
    };

    expect(record.files.count).toBe(80);
    expect(record.files.totalCount).toBe(81);
    expect(record.files.hashTruncated).toBe(true);
    expect(record.files.hashed).toHaveLength(80);
  });
});
