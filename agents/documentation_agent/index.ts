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
    const deterministicFindings: string[] = [];
    const recommendations: string[] = [];

    if (!context.discovery.files.some((file) => file.startsWith("docs/"))) {
      deterministicFindings.push("No documentation directory was detected in the target repository.");
      recommendations.push("Maintain generated docs alongside hand-written operating knowledge.");
    }

    const aiResponse = await this.requestStructuredAI(context, {
      task: "documentation-review",
      systemPromptFile: "documentation.system.md",
      analysisPrompt: [
        `Review the repository documentation posture and operational readability.`,
        `Docs detected: ${context.discovery.files.some((file) => file.startsWith("docs/")) ? "yes" : "no"}.`,
        `API files: ${context.discovery.apiFiles.join(", ") || "None"}.`,
        `CI providers: ${context.discovery.ci.providers.join(", ") || "Not detected"}.`,
        `Observability: logging=${context.discovery.logging.frameworks.join(", ") || "none"}, metrics=${context.discovery.metrics.tools.join(", ") || "none"}.`,
        `Deterministic findings: ${deterministicFindings.join(" | ") || "None"}.`
      ].join("\n")
    });

    return this.buildAIEnhancedEvaluation(
      {
        title: "Documentation Report",
        summary: "DocumentationAgent generated architecture, API, and runbook documents.",
        deterministicFindings,
        recommendations,
        riskLevel: "low"
      },
      aiResponse
    );
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
