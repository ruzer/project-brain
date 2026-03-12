import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class ArchitectureAgent extends BaseAgent {
  constructor() {
    super("architecture-agent", "architecture_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const deterministicFindings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;

    if (discovery.structure.subrepos.length > 2) {
      deterministicFindings.push("Multiple nested packages suggest growing architectural complexity.");
      recommendations.push("Define explicit module boundaries and ownership across nested packages.");
    }

    if (discovery.languages.length > 2) {
      deterministicFindings.push("Polyglot architecture detected with potential coordination overhead.");
      recommendations.push("Document cross-runtime contracts and integration ownership.");
    }

    if (discovery.infrastructure.includes("Kubernetes") && discovery.ci.providers.length === 0) {
      deterministicFindings.push("Operational infrastructure exists without visible release orchestration controls.");
      recommendations.push("Introduce deployment governance and architecture runbooks for cluster changes.");
    }

    if (discovery.structure.topLevelDirectories.length > 8 && !discovery.files.some((file) => file.startsWith("docs/architecture"))) {
      deterministicFindings.push("Repository surface is broad but architecture documentation is shallow.");
      recommendations.push("Maintain a living architecture map with bounded contexts and critical data flows.");
    }

    const aiResponse = await this.requestStructuredAI(context, {
      task: "architecture-review",
      systemPromptFile: "architect.system.md",
      analysisPrompt: [
        `Review the repository architecture for structural complexity and redesign pressure.`,
        `Languages: ${discovery.languages.join(", ") || "Unknown"}.`,
        `Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}.`,
        `Top-level directories: ${discovery.structure.topLevelDirectories.join(", ") || "Unknown"}.`,
        `Subrepos: ${discovery.structure.subrepos.join(", ") || "None"}.`,
        `Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}.`,
        `Deterministic findings: ${deterministicFindings.join(" | ") || "None"}.`
      ].join("\n")
    });

    return this.buildAIEnhancedEvaluation(
      {
        title: "Architecture Report",
        summary: "ArchitectureAgent evaluated structure, boundaries, and architectural drift signals.",
        deterministicFindings,
        recommendations,
        riskLevel: deterministicFindings.length >= 3 ? "high" : deterministicFindings.length >= 1 ? "medium" : "low"
      },
      aiResponse
    );
  }
}
