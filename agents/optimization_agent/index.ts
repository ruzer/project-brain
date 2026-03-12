import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class OptimizationAgent extends BaseAgent {
  constructor() {
    super("optimization-agent", "optimization_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const deterministicFindings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;
    const dependencyCount = new Set(
      discovery.dependencies.flatMap((manifest) => manifest.dependencies.map((dependency) => dependency.toLowerCase()))
    ).size;

    if (dependencyCount > 80) {
      deterministicFindings.push(`High dependency surface detected (${dependencyCount} unique packages).`);
      recommendations.push("Review unused packages and separate production dependencies from tooling dependencies.");
    }

    if (discovery.infrastructure.includes("Dockerfile") && discovery.dockerStageCount === 1) {
      deterministicFindings.push("Docker builds appear single-stage, which often increases image size and attack surface.");
      recommendations.push("Adopt a multi-stage Docker build to reduce runtime footprint.");
    }

    if (discovery.structure.sourceFileCount > 250 && discovery.ci.providers.length === 0) {
      deterministicFindings.push("Large codebase detected without CI acceleration or caching signals.");
      recommendations.push("Add build caching, parallel quality gates, and dependency pruning to keep cycle time stable.");
    }

    const aiResponse = await this.requestStructuredAI(context, {
      task: "performance-analysis",
      systemPromptFile: "optimization.system.md",
      analysisPrompt: [
        `Review the repository for low-risk optimization opportunities.`,
        `Unique dependencies: ${dependencyCount}.`,
        `Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}.`,
        `Docker stages: ${discovery.dockerStageCount}.`,
        `Source files: ${discovery.structure.sourceFileCount}.`,
        `CI providers: ${discovery.ci.providers.join(", ") || "Not detected"}.`,
        `Deterministic findings: ${deterministicFindings.join(" | ") || "None"}.`
      ].join("\n")
    });

    return this.buildAIEnhancedEvaluation(
      {
        title: "Optimization Report",
        summary: "OptimizationAgent evaluated dependency weight and deployment efficiency signals.",
        deterministicFindings,
        recommendations,
        riskLevel: deterministicFindings.length >= 2 ? "medium" : deterministicFindings.length === 1 ? "low" : "low"
      },
      aiResponse
    );
  }
}
