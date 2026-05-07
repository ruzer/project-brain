import path from "node:path";

import { appendFileEnsured, readTextSafe } from "../../shared/fs-utils";
import { StructuredLogger } from "../../shared/logger";
import type { AgentReport, SwarmRunResult } from "../../shared/types";

const logger = new StructuredLogger("learning-store");

function formatFindings(agentReports: AgentReport[]): string[] {
  return agentReports.flatMap((report) =>
    report.findings.map((finding) => `[${report.title}] ${finding}`)
  );
}

function formatLearnings(agentReports: AgentReport[]): string[] {
  return agentReports.flatMap((report) =>
    report.recommendations.map((recommendation) => `[${report.title}] ${recommendation}`)
  );
}

function normalizeMemoryItem(item: string): string {
  return item
    .replace(/^[-*]\s+/, "")
    .replace(/^UNKNOWN:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function appendUniqueMemorySection(filePath: string, timestamp: string, items: string[]): Promise<number> {
  const existing = await readTextSafe(filePath);
  const existingItems = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line))
      .map(normalizeMemoryItem)
      .filter(Boolean)
  );
  const uniqueItems = items
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const normalized = normalizeMemoryItem(item);
      if (!normalized || existingItems.has(normalized)) {
        return false;
      }
      existingItems.add(normalized);
      return true;
    });

  if (uniqueItems.length === 0) {
    return 0;
  }

  await appendFileEnsured(
    filePath,
    `\n## ${timestamp}\n\n${uniqueItems.map((item) => `- ${item}`).join("\n")}\n`
  );
  return uniqueItems.length;
}

export async function recordLearningArtifacts(memoryDir: string, agentReports: AgentReport[]): Promise<void> {
  const errorsPath = path.join(memoryDir, "ERRORS.md");
  const learningsPath = path.join(memoryDir, "LEARNINGS.md");
  const timestamp = new Date().toISOString();
  const findings = formatFindings(agentReports);
  const learnings = formatLearnings(agentReports);

  if (findings.length > 0) {
    await appendUniqueMemorySection(errorsPath, timestamp, findings);
  }

  if (learnings.length > 0) {
    await appendUniqueMemorySection(learningsPath, timestamp, learnings);
  }

  logger.info("Recorded learning artifacts", {
    component: "memory",
    action: "memory_write",
    findings: findings.length,
    learnings: learnings.length,
    memoryDir
  });
}

export async function recordSwarmLearningArtifacts(memoryDir: string, result: SwarmRunResult): Promise<void> {
  const timestamp = new Date().toISOString();
  const decisionsPath = path.join(memoryDir, "DECISIONS.md");
  const errorsPath = path.join(memoryDir, "ERRORS.md");
  const learningsPath = path.join(memoryDir, "LEARNINGS.md");
  const verifiedFacts = result.synthesis.verifiedFacts ?? [];
  const unknowns = result.synthesis.unknowns ?? [];
  const nextSteps = result.synthesis.nextSteps ?? [];
  const priorities = result.synthesis.priorities ?? [];

  await appendUniqueMemorySection(decisionsPath, timestamp, [
    `Swarm analyzed intent: ${result.intent}`,
    `Synthesis headline: ${result.synthesis.headline}`
  ]);

  if (verifiedFacts.length > 0 || priorities.length > 0 || nextSteps.length > 0) {
    await appendUniqueMemorySection(learningsPath, timestamp, [...verifiedFacts, ...priorities, ...nextSteps]);
  }

  if (unknowns.length > 0) {
    await appendUniqueMemorySection(errorsPath, timestamp, unknowns.map((item) => `UNKNOWN: ${item}`));
  }

  logger.info("Recorded swarm learning artifacts", {
    component: "memory",
    action: "memory_write",
    verifiedFacts: verifiedFacts.length,
    unknowns: unknowns.length,
    nextSteps: nextSteps.length,
    memoryDir
  });
}
