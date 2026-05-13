import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { WORKFLOW_DEFINITIONS } from "../../core/workflow_registry";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function seedRepo(repoDir: string): Promise<void> {
  await writeFileEnsured(path.join(repoDir, "package.json"), '{"name":"start-registry","version":"1.0.0"}\n');
  await writeFileEnsured(path.join(repoDir, "src", "index.ts"), "export const startRegistry = true;\n");
}

describe("start workflow registry integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("builds the start plan from cheap workflow registry definitions", async () => {
    const repoDir = await createTempOutputDir("project-brain-start-registry-repo");
    const outputDir = await createTempOutputDir("project-brain-start-registry-output");
    cleanupTargets.push(repoDir, outputDir);
    await seedRepo(repoDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.start(repoDir, outputDir, "optimize analysis and cost");

    const expected = WORKFLOW_DEFINITIONS
      .filter((workflow) => workflow.cheap)
      .sort((left, right) => left.resumePriority - right.resumePriority || left.workflowId.localeCompare(right.workflowId))
      .map((workflow) => workflow.workflowId);

    expect(result.executedSteps.map((step) => step.id)).toEqual(expected);
  });
});
