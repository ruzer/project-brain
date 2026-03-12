import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, workspaceFixturePath } from "../helpers";

describe("Workspace analysis integration", () => {
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

  it("analyzes multiple repositories and writes shared ecosystem artifacts", async () => {
    const outputDir = await createTempOutputDir("project-brain-ecosystem");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.analyzeScope(workspaceFixturePath, outputDir, "repository-change");

    expect("repositories" in result).toBe(true);

    if (!("repositories" in result)) {
      return;
    }

    expect(result.repositories.map((repository) => repository.repoName)).toEqual([
      "CashCalculator",
      "ERP",
      "OffRoadHub",
      "project-brain"
    ]);
    await access(result.knowledgeGraphPath);
    await access(result.ecosystemReportPath);
    await access(result.runtimeObservabilityPath);
    await access(result.telemetryPath);

    const knowledgeGraph = JSON.parse(await readFile(result.knowledgeGraphPath, "utf8")) as {
      repositories: Array<{ repo: string }>;
      repeatedBugs: Array<{ pattern: string; repositories: string[] }>;
    };
    const ecosystemReport = await readFile(result.ecosystemReportPath, "utf8");

    expect(knowledgeGraph.repositories).toHaveLength(4);
    expect(
      knowledgeGraph.repeatedBugs.some(
        (pattern) =>
          pattern.pattern === "missing automated test baseline" &&
          pattern.repositories.includes("ERP") &&
          pattern.repositories.includes("OffRoadHub")
      )
    ).toBe(true);
    expect(ecosystemReport).toContain("Repository Health");
    expect(ecosystemReport).toContain("Repeated Risks");
    expect(result.proposalPaths.length).toBeGreaterThan(0);
    expect(
      result.repositories.every((repository) =>
        repository.outputPath.startsWith(path.join(outputDir, "ecosystem"))
      )
    ).toBe(true);
  }, 15000);
});
