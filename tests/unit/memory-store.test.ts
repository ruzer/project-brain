import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiscoveryEngine } from "../../core/discovery_engine";
import { initializeProjectMemory, writeDiscoveryArtifacts } from "../../memory/context_store";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

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
});
