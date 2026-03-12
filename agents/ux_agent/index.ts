import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class UXAgent extends BaseAgent {
  constructor() {
    super("ux-agent", "ux_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const deterministicFindings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;
    const isFrontendProject = discovery.frameworks.some((framework) => ["React", "NextJS"].includes(framework));

    if (isFrontendProject && !discovery.files.some((file) => /(^|\/)readme\.md$/i.test(file))) {
      deterministicFindings.push("Frontend onboarding starts without a root README, increasing navigation and workflow ambiguity.");
      recommendations.push("Document primary user flows, setup steps, and UI ownership in a root README.");
    }

    if (isFrontendProject && discovery.apis.includes("REST") && !discovery.apis.includes("OpenAPI")) {
      deterministicFindings.push("Frontend-facing API workflows exist without a visible contract, which increases cognitive load for UI changes.");
      recommendations.push("Publish and version an API contract so frontend workflows remain understandable and consistent.");
    }

    if (discovery.structure.topLevelDirectories.length > 10 && !discovery.files.some((file) => file.startsWith("docs/"))) {
      deterministicFindings.push("The repository surface is broad without supporting docs, which suggests high navigation complexity for operators and contributors.");
      recommendations.push("Add workflow and navigation docs that explain the main user journeys and UI-relevant boundaries.");
    }

    const aiResponse = await this.requestStructuredAI(context, {
      task: "ux-audit",
      systemPromptFile: "ux.system.md",
      analysisPrompt: [
        `Evaluate the repository for UX and workflow complexity signals.`,
        `Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}.`,
        `APIs: ${discovery.apis.join(", ") || "Not detected"}.`,
        `Top-level directories: ${discovery.structure.topLevelDirectories.join(", ") || "Unknown"}.`,
        `Deterministic findings: ${deterministicFindings.join(" | ") || "None"}.`
      ].join("\n")
    });

    return this.buildAIEnhancedEvaluation(
      {
        title: "UX Report",
        summary: "UXAgent evaluated navigation clarity, workflow complexity, and enterprise usability signals.",
        deterministicFindings,
        recommendations,
        riskLevel: deterministicFindings.length >= 2 ? "medium" : deterministicFindings.length === 1 ? "low" : "low"
      },
      aiResponse
    );
  }
}
