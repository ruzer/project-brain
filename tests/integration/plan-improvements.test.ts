import { access, readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Improvement plan integration", () => {
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

  it("writes persistent improvement planning artifacts", async () => {
    const outputDir = await createTempOutputDir("project-brain-plan");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.planImprovements(fixtureRepoPath, outputDir, "repository-change");

    await access(result.summaryPath);
    await access(result.statePath);
    await access(result.risksPath);
    await access(result.roadmapPath);
    await access(result.tracksPath);

    const summary = await readFile(result.summaryPath, "utf8");
    const roadmap = await readFile(result.roadmapPath, "utf8");
    const tracks = await readFile(result.tracksPath, "utf8");

    expect(summary).toContain("Improvement Plan Summary");
    expect(summary).toContain("Top actions now");
    expect(roadmap).toContain("# Roadmap");
    expect(roadmap).toContain("## Now");
    expect(tracks).toContain("# Tracks");
  });
});
