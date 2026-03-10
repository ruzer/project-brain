import path from "node:path";

import { writeFileEnsured } from "../shared/fs-utils";
import { StructuredLogger } from "../shared/logger";
import type { AgentEvaluation, AgentReport, ProjectContext } from "../shared/types";

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

export function renderAgentReport(evaluation: AgentEvaluation): string {
  return `# ${evaluation.title}

## Summary

${evaluation.summary}

## Findings

${renderList(evaluation.findings)}

## Recommendations

${renderList(evaluation.recommendations)}
`;
}

export abstract class BaseAgent {
  protected readonly logger: StructuredLogger;

  constructor(
    public readonly agentId: string,
    private readonly reportFileName: string
  ) {
    this.logger = new StructuredLogger("agent", { agent: agentId });
  }

  protected abstract evaluate(context: ProjectContext): Promise<AgentEvaluation>;

  async run(context: ProjectContext): Promise<AgentReport> {
    this.logger.info("Agent analysis started", {
      action: "analysis_start",
      repoName: context.repoName,
      outputPath: context.reportsDir
    });
    const evaluation = await this.evaluate(context);
    const outputPath = path.join(context.reportsDir, this.reportFileName);
    const content = evaluation.content ?? renderAgentReport(evaluation);

    await writeFileEnsured(outputPath, content);

    this.logger.info("Agent analysis completed", {
      action: "analysis_complete",
      repoName: context.repoName,
      findings: evaluation.findings.length,
      recommendations: evaluation.recommendations.length,
      reportPath: outputPath
    });

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
