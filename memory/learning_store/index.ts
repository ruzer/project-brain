import path from "node:path";

import { appendFileEnsured } from "../../shared/fs-utils";
import { StructuredLogger } from "../../shared/logger";
import type { AgentReport } from "../../shared/types";

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
