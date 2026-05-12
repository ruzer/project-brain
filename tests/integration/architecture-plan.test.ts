import { access, readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Architecture plan integration", () => {
  const cleanupTargets: string[] = [];
  const originalOllamaTimeout = process.env.OLLAMA_TIMEOUT_MS;

  beforeEach(() => {
    process.env.OLLAMA_TIMEOUT_MS = "1";
  });

  afterEach(async () => {
    if (originalOllamaTimeout === undefined) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = originalOllamaTimeout;
    }
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("writes architecture planning artifacts and context", async () => {
    const outputDir = await createTempOutputDir("project-brain-architecture-plan");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.architecturePlan(fixtureRepoPath, outputDir);

    await access(result.planDir);
    await access(result.blueprintPath);
    await access(result.statePath);
    await access(result.claudeContextPath);
    await access(result.memoryPath);

    const blueprint = await readFile(result.blueprintPath, "utf8");
    const state = await readFile(result.statePath, "utf8");
    const claude = await readFile(result.claudeContextPath, "utf8");
    const memory = await readFile(result.memoryPath, "utf8");
    const memoryPayload = JSON.parse(memory) as { repoName: string };

    expect(blueprint).toContain("Architecture Blueprint");
    expect(state).toContain("Architecture Evolution State");
    expect(claude).toContain("CLAUDE Working Context");
    expect(memoryPayload.repoName.length).toBeGreaterThan(0);
    expect(state).toContain(result.context.repoName);
    expect(blueprint).toContain(result.context.discovery.infrastructure.join(", ") || "Not explicitly detected");
  });
});
