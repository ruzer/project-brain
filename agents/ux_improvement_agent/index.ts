import { BaseAgent } from "../base-agent";
import {
  analyzeFrontendUsability,
  filterOperationalUXItems,
  formatFrontendUsabilityAnalysis,
  formatComponentCatalog,
  generateUXImprovementArtifacts,
  loadUXImprovementInputs
} from "../../analysis/ux_task_generator";
import {
  combineRecommendations,
  mergeRiskLevel,
  normalizeAIImprovement,
  normalizeAIInsight
} from "../ai-support";

import type { AgentEvaluation, AgentReport, ProjectContext } from "../../shared/types";

interface UXImprovementPlan {
  evaluation: AgentEvaluation;
  findings: string[];
  recommendations: string[];
  inputFiles: string[];
  emptyMessage?: string;
}

function summarizeItems(items: string[], fallback: string): string {
  return items.length > 0 ? items.join(" | ") : fallback;
}

export class UXImprovementAgent extends BaseAgent {
  constructor() {
    super("ux-improvement-agent", "UX_IMPLEMENTATION_TASKS.md");
  }

  private async buildPlan(context: ProjectContext): Promise<UXImprovementPlan> {
    const inputs = await loadUXImprovementInputs(context);
    const analysis = await analyzeFrontendUsability(context.targetPath);

    if (!inputs.frontendDetected) {
      return {
        evaluation: {
          title: "UX Improvement Tasks",
          summary:
            "UXImprovementAgent skipped task generation because no frontend source surface was detected under the expected UI roots.",
          findings: ["No frontend component surface was detected under src/components, src/app, src/layouts, src/pages, or src/features."],
          recommendations: [],
          riskLevel: "low"
        },
        findings: [],
        recommendations: [],
        inputFiles: inputs.inputFiles,
        emptyMessage: "No frontend component surface was detected under src, so no UI implementation tasks were generated."
      };
    }

    if (inputs.inputFiles.length === 0) {
      return {
        evaluation: {
          title: "UX Improvement Tasks",
          summary: "UXImprovementAgent skipped task generation because no UX source reports were available for this repository output.",
          findings: [
            "No UX source reports were found in reports/ux_report.md, reports/usability_findings.md, or reports/workflow_analysis.md."
          ],
          recommendations: [],
          riskLevel: "low"
        },
        findings: [],
        recommendations: [],
        inputFiles: inputs.inputFiles,
        emptyMessage: "No UX source reports were found, so no implementation tasks could be generated. Run UXAgent first."
      };
    }

    const aiResponse = await this.requestStructuredAI(context, {
      task: "ux-improvement",
      systemPromptFile: "ux-improvement.system.md",
      analysisPrompt: [
        "Convert operational UX findings into implementation-ready frontend improvements for ERP users.",
        "Primary users: non-technical government administrative staff performing repetitive form-based work.",
        "Critical rule: prioritize functional usability and workflow clarity over visual design.",
        "Ignore README files, onboarding guides, installation instructions, and developer documentation.",
        "Do not propose backend, OpenAPI, Prisma, or server-side changes.",
        `Source reports: ${inputs.inputFiles.join(", ")}.`,
        formatFrontendUsabilityAnalysis(analysis),
        formatComponentCatalog(inputs),
        `Findings: ${summarizeItems(inputs.findings, "None")}.`,
        `Recommendations: ${summarizeItems(inputs.recommendations, "None")}.`
      ].join("\n")
    });

    const mergedFindings = filterOperationalUXItems(
      combineRecommendations(inputs.findings, analysis.findings, aiResponse?.issues.map(normalizeAIInsight) ?? [])
    );
    const mergedRecommendations = filterOperationalUXItems(
      combineRecommendations(
        inputs.recommendations,
        analysis.recommendations,
        aiResponse?.proposed_improvements.map(normalizeAIImprovement) ?? []
      )
    );

    const summary =
      mergedFindings.length > 0
        ? `UXImprovementAgent translated ${inputs.inputFiles.length} UX source reports into component-level frontend tasks.`
        : "UXImprovementAgent reviewed the available UX source reports but did not find actionable frontend implementation tasks.";

    return {
      evaluation: {
        title: "UX Improvement Tasks",
        summary,
        findings: mergedFindings,
        recommendations: mergedRecommendations,
        riskLevel: mergeRiskLevel(
          mergedFindings.some((finding) => /workflow|navigation|form|table|dashboard|search|error clarity/i.test(finding))
            ? "medium"
            : "low",
          (aiResponse?.issues ?? []).filter((issue) => filterOperationalUXItems([normalizeAIInsight(issue)]).length > 0)
        )
      },
      findings: mergedFindings,
      recommendations: mergedRecommendations,
      inputFiles: inputs.inputFiles,
      emptyMessage:
        mergedFindings.length === 0 && mergedRecommendations.length === 0
          ? "No actionable UX issues were derived from the current UX source reports."
          : undefined
    };
  }

  async run(context: ProjectContext): Promise<AgentReport> {
    this.logger.info("Agent analysis started", {
      action: "analysis_start",
      repoName: context.repoName,
      outputPath: context.outputPath
    });

    const plan = await this.buildPlan(context);
    const artifacts = await generateUXImprovementArtifacts(context, {
      findings: plan.findings,
      recommendations: plan.recommendations,
      inputFiles: plan.inputFiles,
      emptyMessage: plan.emptyMessage
    });

    this.logger.info("Agent analysis completed", {
      action: "analysis_complete",
      repoName: context.repoName,
      findings: plan.evaluation.findings.length,
      recommendations: plan.evaluation.recommendations.length,
      reportPath: artifacts.implementationTasksPath,
      navigationPath: artifacts.navigationRestructurePath,
      formPath: artifacts.formSimplificationTasksPath,
      workspacePath: artifacts.workspaceImprovementsPath
    });

    return {
      agentId: this.agentId,
      title: plan.evaluation.title,
      summary: plan.evaluation.summary,
      findings: plan.evaluation.findings,
      recommendations: plan.evaluation.recommendations,
      riskLevel: plan.evaluation.riskLevel,
      outputPath: artifacts.implementationTasksPath
    };
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const plan = await this.buildPlan(context);
    return plan.evaluation;
  }
}
