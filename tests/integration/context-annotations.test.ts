import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Context annotations integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("persists annotations and surfaces them in generated context artifacts", async () => {
    const outputDir = await createTempOutputDir("project-brain-annotations");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const annotation = await orchestrator.annotateTarget(fixtureRepoPath, outputDir, {
      scope: "repo",
      note: "Legacy billing paths are fragile; avoid broad refactors without a safety net."
    });
    const mapResult = await orchestrator.mapTarget(fixtureRepoPath, outputDir);

    expect(annotation.scope).toBe("repo");

    const annotations = await orchestrator.listAnnotations(fixtureRepoPath, outputDir);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.note).toContain("Legacy billing paths are fragile");

    await access(path.join(outputDir, "memory", "annotations", "index.json"));

    const annotationsArtifact = await readFile(path.join(outputDir, "AI_CONTEXT", "ANNOTATIONS.md"), "utf8");
    const summary = await readFile(mapResult.summaryPath, "utf8");

    expect(annotationsArtifact).toContain("Legacy billing paths are fragile");
    expect(summary).toContain("Local Notes");
    expect(summary).toContain("Legacy billing paths are fragile");
  });
});
