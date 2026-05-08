import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordLearningArtifacts, recordSwarmLearningArtifacts } from "../../memory/learning_store";
import type { AgentReport, SwarmRunResult } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

function countNormalized(content: string, needle: string): number {
  const normalizedNeedle = needle.toLowerCase();
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^UNKNOWN:\s*/i, "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((line) => line === normalizedNeedle)
    .length;
}

describe("learning store", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("deduplicates learning artifacts across repeated normalized bullets", async () => {
    const memoryDir = await createTempOutputDir("project-brain-learning-store");
    cleanupTargets.push(memoryDir);
    const report: AgentReport = {
      agentId: "qa",
      title: "QA",
      summary: "summary",
      findings: ["  Duplicate finding  "],
      recommendations: ["Repeat recommendation"],
      riskLevel: "low",
      outputPath: "qa.md"
    };

    await recordLearningArtifacts(memoryDir, [report]);
    await recordLearningArtifacts(memoryDir, [
      {
        ...report,
        findings: ["duplicate   finding"],
        recommendations: ["repeat recommendation"]
      }
    ]);

    const errors = await readFile(path.join(memoryDir, "ERRORS.md"), "utf8");
    const learnings = await readFile(path.join(memoryDir, "LEARNINGS.md"), "utf8");
    expect(countNormalized(errors, "[QA] Duplicate finding")).toBe(1);
    expect(countNormalized(learnings, "[QA] Repeat recommendation")).toBe(1);
  });

  it("deduplicates swarm unknowns ignoring UNKNOWN prefix", async () => {
    const memoryDir = await createTempOutputDir("project-brain-swarm-learning-store");
    cleanupTargets.push(memoryDir);
    const result = {
      intent: "inspect auth",
      synthesis: {
        headline: "Auth summary",
        verifiedFacts: [],
        unknowns: ["Auth state unclear"],
        nextSteps: [],
        priorities: []
      }
    } as SwarmRunResult;

    await recordSwarmLearningArtifacts(memoryDir, result);
    await recordSwarmLearningArtifacts(memoryDir, {
      ...result,
      synthesis: {
        ...result.synthesis,
        unknowns: ["UNKNOWN: auth state unclear"]
      }
    });

    const errors = await readFile(path.join(memoryDir, "ERRORS.md"), "utf8");
    expect(countNormalized(errors, "auth state unclear")).toBe(1);
  });
});
