import path from "node:path";

import {
  buildRepoSummary,
  combineRecommendations,
  loadAgentSystemPrompt,
  mergeRiskLevel,
  normalizeAIImprovement,
  normalizeAIInsight,
  parseAgentAIResponse,
  type AgentAIResponse
} from "./ai-support";
import { AIRouter, type AIRouterTask } from "../core/ai_router/router";
import { writeFileEnsured } from "../shared/fs-utils";
import { StructuredLogger } from "../shared/logger";
import type { AgentEvaluation, AgentReport, ProjectContext } from "../shared/types";

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

export function renderAgentReport(evaluation: AgentEvaluation): string {
  if (evaluation.deterministicFindings || evaluation.aiInsights || evaluation.combinedRecommendations) {
    return `# ${evaluation.title}

## Summary

${evaluation.summary}

## Human Deterministic Findings

${renderList(evaluation.deterministicFindings ?? evaluation.findings)}

## AI Insights

${renderList(evaluation.aiInsights ?? ["AI insights were unavailable for this cycle."])}

## Combined Recommendations

${renderList(evaluation.combinedRecommendations ?? evaluation.recommendations)}
`;
  }

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
  protected readonly aiRouter: AIRouter;

  constructor(
    public readonly agentId: string,
    private readonly reportFileName: string
  ) {
    this.logger = new StructuredLogger("agent", { agent: agentId });
    this.aiRouter = new AIRouter();
  }

  protected abstract evaluate(context: ProjectContext): Promise<AgentEvaluation>;

  protected buildRepoSummary(context: ProjectContext): string {
    return buildRepoSummary(context);
  }

  protected async requestStructuredAI(
    context: ProjectContext,
    input: {
      task: AIRouterTask;
      systemPromptFile: string;
      analysisPrompt: string;
    }
  ): Promise<AgentAIResponse | undefined> {
    try {
      const systemPrompt = await loadAgentSystemPrompt(input.systemPromptFile);
      const prompt = [
        systemPrompt.trim(),
        "",
        "Repository context:",
        this.buildRepoSummary(context),
        "",
        "Deterministic analysis:",
        input.analysisPrompt.trim(),
        "",
        "Return JSON only."
      ].join("\n");
      const response = await this.aiRouter.ask({
        task: input.task,
        prompt,
        context: this.buildRepoSummary(context)
      });
      const parsed = parseAgentAIResponse(response);

      if (!parsed) {
        this.logger.warn("AI response was not valid structured JSON", {
          action: "ai_parse_failed",
          task: input.task
        });
      }

      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("AI analysis fallback engaged", {
        action: "ai_fallback",
        error: message,
        task: input.task
      });
      return undefined;
    }
  }

  protected buildAIEnhancedEvaluation(
    base: {
      title: string;
      summary: string;
      deterministicFindings: string[];
      recommendations: string[];
      riskLevel: AgentEvaluation["riskLevel"];
    },
    aiResponse: AgentAIResponse | undefined
  ): AgentEvaluation {
    const aiInsights = aiResponse?.issues.map(normalizeAIInsight) ?? ["AI insights were unavailable for this cycle."];
    const aiRecommendations = aiResponse?.proposed_improvements.map(normalizeAIImprovement) ?? [];
    const combinedRecommendations = combineRecommendations(base.recommendations, aiRecommendations);

    return {
      title: base.title,
      summary: base.summary,
      deterministicFindings: base.deterministicFindings,
      aiInsights,
      combinedRecommendations,
      findings: combineRecommendations(base.deterministicFindings, aiResponse?.issues.map(normalizeAIInsight) ?? []),
      recommendations: combinedRecommendations,
      riskLevel: mergeRiskLevel(base.riskLevel, aiResponse?.issues ?? [])
    };
  }

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
