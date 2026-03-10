import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { DevAgent } from "../../agents/dev_agent";
import { ContextBuilder } from "../../core/context_builder";
import { DiscoveryEngine } from "../../core/discovery_engine";
import { cleanupDir, createTempOutputDir, devAgentFixtureRepoPath } from "../helpers";

describe("DevAgent integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("produces actionable architectural findings for a repository fixture", async () => {
    const outputDir = await createTempOutputDir("project-brain-dev-agent");
    cleanupTargets.push(outputDir);

    const discovery = await new DiscoveryEngine().analyze(devAgentFixtureRepoPath);
    const context = await new ContextBuilder().build(discovery, outputDir);
    const report = await new DevAgent().run(context);
    const content = await readFile(report.outputPath, "utf8");

    expect(report.outputPath.endsWith("dev_architecture_analysis.md")).toBe(true);
    expect(report.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(content).toContain("Top 10 Architecture Risks");
    expect(content).toContain("Architectural Observations");
    expect(content).toContain("Break circular module dependencies");
  });
});
