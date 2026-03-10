import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Orchestrator integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("runs a repository-change cycle and persists governance output", async () => {
    const outputDir = await createTempOutputDir("project-brain-cycle");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.analyzeTarget(fixtureRepoPath, outputDir, "repository-change");

    expect(result.governanceSummary).toBeDefined();
    expect(result.agentReports.length).toBeGreaterThan(0);
    expect(result.governanceSummary?.proposals.length ?? 0).toBeGreaterThan(0);

    await access(path.join(outputDir, "reports", "agent_activity_report.md"));
    await access(path.join(outputDir, "reports", "improvement_proposals.md"));
    await access(path.join(outputDir, "reports", "improvement_report.md"));
    await access(path.join(outputDir, "reports", "runtime_observability.md"));
    await access(path.join(outputDir, "reports", "telemetry"));
    await access(result.governanceSummary!.proposals[0]!.filePath);
    await access(path.join(outputDir, "tasks", "messages.json"));

    const learnings = JSON.parse(
      await readFile(path.join(outputDir, "memory", "learnings", "index.json"), "utf8")
    ) as Array<{ lessonId: string }>;
    const telemetryFiles = await readFile(path.join(outputDir, "reports", "runtime_observability.md"), "utf8");

    expect(learnings.length).toBeGreaterThan(0);
    expect(telemetryFiles).toContain("Average cycle duration");
    expect(
      result.governanceSummary?.proposals.some((proposal) =>
        ["APPROVED", "REQUIRES_HUMAN_REVIEW", "REJECTED"].includes(proposal.status)
      )
    ).toBe(true);
  });

  it("records governance feedback and archives it in runtime memory", async () => {
    const outputDir = await createTempOutputDir("project-brain-governance");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.analyzeTarget(fixtureRepoPath, outputDir, "repository-change");
    const qaTask = result.governanceSummary?.tasks.find((task) => task.agentId === "qa-agent");

    expect(qaTask).toBeDefined();

    const record = await orchestrator.recordFeedback(fixtureRepoPath, outputDir, {
      agentId: "qa-agent",
      taskId: qaTask!.taskId,
      context: "Safety baseline review",
      detectedProblem: "Missing test automation on core runtime",
      actionTaken: "Escalated smoke test proposal",
      outcome: "SUCCESSFUL_PROPOSAL",
      confidenceScore: 0.95
    });

    const completed = JSON.parse(
      await readFile(path.join(outputDir, "tasks", "completed.json"), "utf8")
    ) as Array<{ taskId: string; state: string }>;

    expect(record.outcome).toBe("SUCCESSFUL_PROPOSAL");
    expect(completed.some((task) => task.taskId === qaTask!.taskId && task.state === "APPROVED")).toBe(true);
  });
});
