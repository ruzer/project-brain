import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function seedRepo(repoDir: string): Promise<void> {
  await writeFileEnsured(path.join(repoDir, "package.json"), '{"name":"runbook-fixture","version":"1.0.0"}\n');
  await writeFileEnsured(path.join(repoDir, "src", "index.ts"), "export const runbook = true;\n");
}

describe("runbook", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("writes a token-aware execution runbook from existing artifacts", async () => {
    const repoDir = await createTempOutputDir("project-brain-runbook-repo");
    const outputDir = await createTempOutputDir("project-brain-runbook-output");
    cleanupTargets.push(repoDir, outputDir);

    await seedRepo(repoDir);

    const orchestrator = new ProjectBrainOrchestrator();
    await orchestrator.buildCodeGraph(repoDir, outputDir);
    await orchestrator.factQuery(repoDir, outputDir, "runbook src");

    const result = await orchestrator.runbook(repoDir, outputDir, "optimize analysis cost");

    await access(result.reportPath);
    await access(result.memoryPath);
    expect(result.steps.some((step) => step.title === "Build factual graph" && step.status === "done")).toBe(true);
    expect(result.steps.some((step) => step.title === "Query factual memory" && step.status === "done")).toBe(true);
    expect(result.steps.some((step) => step.title === "Run bounded swarm" && step.usesModel)).toBe(true);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Run deterministic memory and graph steps before model-heavy analysis.");
  });
});
