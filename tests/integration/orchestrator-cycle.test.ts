import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Orchestrator integration", () => {
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
    await access(path.join(outputDir, "reports", "agent_firewall.md"));
    await access(path.join(outputDir, "memory", "firewall", "agent_firewall.json"));
    await access(path.join(outputDir, "reports", "telemetry"));
    await access(result.governanceSummary!.proposals[0]!.filePath);
    await access(path.join(outputDir, "tasks", "messages.json"));
    await access(path.join(outputDir, "tasks", "packets"));

    const learnings = JSON.parse(
      await readFile(path.join(outputDir, "memory", "learnings", "index.json"), "utf8")
    ) as Array<{ lessonId: string }>;
    const telemetryFiles = await readFile(path.join(outputDir, "reports", "runtime_observability.md"), "utf8");
    const activityReport = await readFile(path.join(outputDir, "reports", "agent_activity_report.md"), "utf8");
    const improvementReport = await readFile(path.join(outputDir, "reports", "improvement_proposals.md"), "utf8");

    expect(learnings.length).toBeGreaterThan(0);
    expect(telemetryFiles).toContain("Average cycle duration");
    expect(
      result.governanceSummary?.proposals.some((proposal) =>
        ["APPROVED", "REQUIRES_HUMAN_REVIEW", "REJECTED"].includes(proposal.status)
      )
    ).toBe(true);
    expect(result.governanceSummary?.proposals.every((proposal) => Number.isFinite(proposal.consensusScore))).toBe(true);
    expect(
      result.governanceSummary?.proposals.every((proposal) =>
        ["strong", "moderate", "weak"].includes(proposal.consensusState)
      )
    ).toBe(true);
    expect(result.governanceSummary?.firewall).toBeDefined();
    expect((result.governanceSummary?.firewall?.packets.length ?? 0)).toBeGreaterThan(0);
    expect((result.governanceSummary?.firewall?.stats.reviewRequired ?? 0)).toBeGreaterThan(0);
    expect(result.governanceSummary?.proposals.every((proposal) => Array.isArray(proposal.supportingAgents))).toBe(true);
    expect(result.governanceSummary?.proposals.every((proposal) => Array.isArray(proposal.consensusThemes))).toBe(true);
    expect(activityReport).toContain("Strong-consensus proposals:");
    expect(improvementReport).toContain("consensus=");
  });

  it("inspects firewall policy without running the full agent cycle", async () => {
    const outputDir = await createTempOutputDir("project-brain-firewall");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.inspectFirewall(fixtureRepoPath, outputDir, "repository-change");

    expect(result.firewall.packets.length).toBeGreaterThan(0);
    expect(result.firewall.stats.reviewRequired).toBeGreaterThan(0);

    await access(result.firewall.reportPath);
    await access(result.firewall.policyPath);

    const firewallReport = await readFile(result.firewall.reportPath, "utf8");
    expect(firewallReport).toContain("Agent Firewall Report");
    expect(firewallReport).toContain("edit-limited");
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
