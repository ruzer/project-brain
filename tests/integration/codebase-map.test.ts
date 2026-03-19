import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Codebase map integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("writes structured codebase map artifacts for a repository", async () => {
    const outputDir = await createTempOutputDir("project-brain-codebase-map");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.mapScope(fixtureRepoPath, outputDir);

    expect("context" in result).toBe(true);
    if (!("context" in result)) {
      throw new Error("Expected a single-repository codebase map result.");
    }

    const expectedFiles = [
      "SUMMARY.md",
      "STACK.md",
      "INTEGRATIONS.md",
      "ARCHITECTURE.md",
      "STRUCTURE.md",
      "CONVENTIONS.md",
      "TESTING.md",
      "CONCERNS.md"
    ];

    expect(result.codebaseMapDir).toBe(path.join(outputDir, "docs", "codebase_map"));
    expect(result.files).toHaveLength(expectedFiles.length);

    for (const fileName of expectedFiles) {
      const content = await readFile(path.join(result.codebaseMapDir, fileName), "utf8");
      expect(content.trim().length).toBeGreaterThan(20);
    }

    const summary = await readFile(path.join(result.codebaseMapDir, "SUMMARY.md"), "utf8");
    expect(summary).toContain("sample-repo");
    expect(summary).toContain("Codebase Map Summary");
    expect(summary).toContain("project-brain analyze");
  });
});
