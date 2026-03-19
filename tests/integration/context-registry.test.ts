import { access, readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Context registry integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("searches the local context registry and writes a report", async () => {
    const outputDir = await createTempOutputDir("project-brain-context-search");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.contextSearch(fixtureRepoPath, outputDir, "express observability", "official");

    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.entry.id).toBe("node-express-api");

    await access(result.reportPath);
    await access(result.cachePath);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Context Search");
    expect(report).toContain("Node + Express API Baseline");
  });

  it("materializes a context entry into AI_CONTEXT external context", async () => {
    const outputDir = await createTempOutputDir("project-brain-context-get");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.contextGet(fixtureRepoPath, outputDir, "node-express-api");

    await access(result.artifactPath);
    await access(result.cachePath);

    const artifact = await readFile(result.artifactPath, "utf8");
    expect(artifact).toContain("Node + Express API Baseline");
    expect(artifact).toContain("Guidance");
  });

  it("lists available context sources with trust levels", async () => {
    const outputDir = await createTempOutputDir("project-brain-context-sources");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.contextSources(fixtureRepoPath, outputDir);

    expect(result.sources.length).toBeGreaterThan(0);
    await access(result.reportPath);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Context Sources");
    expect(report).toContain("project-brain curated");
  });
});
