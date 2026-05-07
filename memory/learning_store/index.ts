import path from "node:path";

import { appendFileEnsured } from "../../shared/fs-utils";
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

export async function recordLearningArtifacts(memoryDir: string, agentReports: AgentReport[]): Promise<void> {
  const errorsPath = path.join(memoryDir, "ERRORS.md");
  const learningsPath = path.join(memoryDir, "LEARNINGS.md");
  const timestamp = new Date().toISOString();
  const findings = formatFindings(agentReports);
  const learnings = formatLearnings(agentReports);

  if (findings.length > 0) {
    await appendFileEnsured(
      errorsPath,
      `\n## ${timestamp}\n\n${findings.map((finding) => `- ${finding}`).join("\n")}\n`
    );
  }

  if (learnings.length > 0) {
    await appendFileEnsured(
      learningsPath,
      `\n## ${timestamp}\n\n${learnings.map((learning) => `- ${learning}`).join("\n")}\n`
    );
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

  await appendFileEnsured(
    decisionsPath,
    `\n## ${timestamp}\n\n- Swarm analyzed intent: ${result.intent}\n- Synthesis headline: ${result.synthesis.headline}\n`
  );

  if (verifiedFacts.length > 0 || priorities.length > 0 || nextSteps.length > 0) {
    await appendFileEnsured(
      learningsPath,
      `\n## ${timestamp}\n\n${[...verifiedFacts, ...priorities, ...nextSteps].map((item) => `- ${item}`).join("\n")}\n`
    );
  }

  if (unknowns.length > 0) {
    await appendFileEnsured(
      errorsPath,
      `\n## ${timestamp}\n\n${unknowns.map((item) => `- UNKNOWN: ${item}`).join("\n")}\n`
    );
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
