import { BaseAgent } from "../base-agent";
import { normalizeAIImprovement, normalizeAIInsight } from "../ai-support";
import {
  analyzeFrontendUsability,
  filterOperationalUXItems,
  formatFrontendUsabilityAnalysis
} from "../../analysis/ux_task_generator";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class UXAgent extends BaseAgent {
  constructor() {
    super("ux-agent", "ux_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const analysis = await analyzeFrontendUsability(context.targetPath);
    const deterministicFindings = filterOperationalUXItems(analysis.findings);
    const recommendations = filterOperationalUXItems(analysis.recommendations);

    if (!analysis.frontendDetected) {
      return {
        title: "UX Report",
        summary: "UXAgent skipped operational UX analysis because no frontend UI surface was detected under the expected frontend source roots.",
        findings: ["No frontend UI surface was detected under src/components, src/app, src/layouts, src/pages, or src/features."],
        recommendations: [],
        riskLevel: "low"
      };
    }

    const aiResponse = await this.requestStructuredAI(context, {
      task: "ux-audit",
      systemPromptFile: "ux.system.md",
      analysisPrompt: [
        "Evaluate the repository only for operational ERP usability in the existing UI.",
        "Primary users: non-technical government administrative staff performing repetitive form-based work.",
        "Critical rule: prioritize functional usability and workflow clarity over visual design.",
        "Ignore README files, onboarding guides, installation instructions, and developer documentation.",
        "Focus only on navigation, sidebar structure, dashboards, forms, terminology, tables, search/filtering, workflow visibility, error clarity, and guided selectors.",
        formatFrontendUsabilityAnalysis(analysis),
        `Deterministic findings: ${deterministicFindings.join(" | ") || "None"}.`
      ].join("\n")
    });
    const filteredAIResponse = aiResponse
      ? {
          issues: aiResponse.issues.filter((issue) => filterOperationalUXItems([normalizeAIInsight(issue)]).length > 0),
          proposed_improvements: aiResponse.proposed_improvements.filter(
            (improvement) => filterOperationalUXItems([normalizeAIImprovement(improvement)]).length > 0
          )
        }
      : undefined;

    return this.buildAIEnhancedEvaluation(
      {
        title: "UX Report",
        summary:
          "UXAgent evaluated operational interface usability for non-technical administrative staff, focusing on navigation, forms, workflow clarity, tables, and search/filter surfaces.",
        deterministicFindings,
        recommendations,
        riskLevel: deterministicFindings.length >= 4 ? "high" : deterministicFindings.length >= 2 ? "medium" : "low"
      },
      filteredAIResponse
    );
  }
}
