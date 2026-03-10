import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class OptimizationAgent extends BaseAgent {
  constructor() {
    super("optimization-agent", "optimization_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;
    const dependencyCount = new Set(
      discovery.dependencies.flatMap((manifest) => manifest.dependencies.map((dependency) => dependency.toLowerCase()))
    ).size;

    if (dependencyCount > 80) {
      findings.push(`High dependency surface detected (${dependencyCount} unique packages).`);
      recommendations.push("Review unused packages and separate production dependencies from tooling dependencies.");
    }

    if (discovery.infrastructure.includes("Dockerfile") && discovery.dockerStageCount === 1) {
      findings.push("Docker builds appear single-stage, which often increases image size and attack surface.");
      recommendations.push("Adopt a multi-stage Docker build to reduce runtime footprint.");
    }

    if (discovery.structure.sourceFileCount > 250 && discovery.ci.providers.length === 0) {
      findings.push("Large codebase detected without CI acceleration or caching signals.");
      recommendations.push("Add build caching, parallel quality gates, and dependency pruning to keep cycle time stable.");
    }

    return {
      title: "Optimization Report",
      summary: "OptimizationAgent evaluated dependency weight and deployment efficiency signals.",
      findings,
      recommendations,
      riskLevel: findings.length >= 2 ? "medium" : findings.length === 1 ? "low" : "low"
    };
  }
}
