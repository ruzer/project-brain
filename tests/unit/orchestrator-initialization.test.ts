import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("ProjectBrainOrchestrator initialization", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("initializes the runtime directories for a target repository", async () => {
    const outputDir = await createTempOutputDir("project-brain-init");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const context = await orchestrator.initTarget(fixtureRepoPath, outputDir);

    expect(context.repoName).toBe("sample-repo");
    expect(context.memoryDir.endsWith("AI_CONTEXT")).toBe(true);
    expect(context.reportsDir.endsWith("reports")).toBe(true);
    expect(context.docsDir.endsWith("docs")).toBe(true);
    expect(context.taskBoardDir.endsWith("tasks")).toBe(true);
    expect(context.learningDir.includes("memory/learnings")).toBe(true);
  });
});
