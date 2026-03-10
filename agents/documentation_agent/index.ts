import path from "node:path";

import { BaseAgent, renderAgentReport } from "../base-agent";
import { writeFileEnsured } from "../../shared/fs-utils";
import type { AgentEvaluation, AgentReport, ProjectContext } from "../../shared/types";

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function buildArchitectureDoc(context: ProjectContext): string {
  const { discovery } = context;
  return `# Architecture

## Overview

- Repository: ${context.repoName}
- Project type: ${discovery.frameworks.join(", ") || discovery.languages.join(", ") || "Unknown"}
- Languages: ${discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}
- Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}

## Structure

${renderList(discovery.structure.topLevelDirectories)}
`;
}

function buildApiDoc(context: ProjectContext): string {
  const { discovery } = context;
  return `# API

## Detected styles

${renderList(discovery.apis)}

## Related files

${renderList(discovery.apiFiles)}
`;
}

function buildRunbook(context: ProjectContext): string {
  const { discovery } = context;
  return `# Runbook

## Operating notes

- CI/CD: ${discovery.ci.providers.join(", ") || "Not detected"}
- Logging: ${discovery.logging.frameworks.join(", ") || "Not detected"}
- Metrics: ${discovery.metrics.tools.join(", ") || "Not detected"}
- Alerts: ${discovery.metrics.alertsConfigured ? "Detected" : "Not detected"}

## Suggested operational actions

${renderList(discovery.recommendations)}
`;
}

export class DocumentationAgent extends BaseAgent {
  constructor() {
    super("documentation-agent", "documentation_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];

    if (!context.discovery.files.some((file) => file.startsWith("docs/"))) {
      findings.push("No documentation directory was detected in the target repository.");
      recommendations.push("Maintain generated docs alongside hand-written operating knowledge.");
    }

    return {
      title: "Documentation Report",
      summary: "DocumentationAgent generated architecture, API, and runbook documents.",
      findings,
      recommendations,
      riskLevel: findings.length > 0 ? "low" : "low"
    };
  }

  async run(context: ProjectContext): Promise<AgentReport> {
    const evaluation = await this.evaluate(context);

    await writeFileEnsured(path.join(context.docsDir, "architecture.md"), buildArchitectureDoc(context));
    await writeFileEnsured(path.join(context.docsDir, "api.md"), buildApiDoc(context));
    await writeFileEnsured(path.join(context.docsDir, "runbook.md"), buildRunbook(context));

    const outputPath = path.join(context.reportsDir, "documentation_report.md");
    await writeFileEnsured(outputPath, renderAgentReport(evaluation));

    return {
      agentId: this.agentId,
      title: evaluation.title,
      summary: evaluation.summary,
      findings: evaluation.findings,
      recommendations: evaluation.recommendations,
      riskLevel: evaluation.riskLevel,
      outputPath
    };
  }
}
