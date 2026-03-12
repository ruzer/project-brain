import { readFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { QAAgent } from "../../agents/qa_agent";
import { ContextBuilder } from "../../core/context_builder";
import { DiscoveryEngine } from "../../core/discovery_engine";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("AI-enabled agent reporting", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("merges AI insights into the report while preserving deterministic findings", async () => {
    const outputDir = await createTempOutputDir("project-brain-ai-report");
    cleanupTargets.push(outputDir);

    const discovery = await new DiscoveryEngine().analyze(fixtureRepoPath);
    const context = await new ContextBuilder().build(discovery, outputDir);
    const agent = new QAAgent() as QAAgent & {
      aiRouter: {
        ask: (input: { task?: string; prompt: string; context?: string }) => Promise<string>;
      };
    };

    agent.aiRouter = {
      async ask(input) {
        expect(input.task).toBe("qa-analysis");
        return JSON.stringify({
          issues: [
            {
              severity: "medium",
              description: "Release validation depends too heavily on manual verification steps."
            }
          ],
          proposed_improvements: [
            {
              type: "testing",
              proposal: "Introduce a small regression suite for the highest-risk flows before weekly releases."
            }
          ]
        });
      }
    };

    const report = await agent.run(context);
    const content = await readFile(report.outputPath, "utf8");

    expect(content).toContain("## Human Deterministic Findings");
    expect(content).toContain("## AI Insights");
    expect(content).toContain("## Combined Recommendations");
    expect(content).toContain("Release validation depends too heavily on manual verification steps.");
    expect(content).toContain("Introduce a small regression suite for the highest-risk flows before weekly releases.");
    expect(report.recommendations.some((recommendation) => recommendation.includes("regression suite"))).toBe(true);
  });
});
