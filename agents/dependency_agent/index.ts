import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class DependencyAgent extends BaseAgent {
  constructor() {
    super("dependency-agent", "dependency_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;
    const manifestCount = discovery.manifests.length;
    const dependencyCount = discovery.dependencies.reduce((sum, manifest) => sum + manifest.dependencies.length, 0);

    if (manifestCount > 3) {
      findings.push(`Multiple dependency manifests detected (${manifestCount}), increasing dependency governance complexity.`);
      recommendations.push("Centralize dependency ownership and standardize update cadence across ecosystems.");
    }

    if (dependencyCount > 120) {
      findings.push(`Dependency volume is high (${dependencyCount} declared dependencies).`);
      recommendations.push("Create a quarterly dependency reduction review focused on low-value or duplicate packages.");
    }

    if (discovery.testing.length === 0 && dependencyCount > 0) {
      findings.push("Dependency changes may be risky because no automated test framework was detected.");
      recommendations.push("Introduce smoke tests before expanding dependency update automation.");
    }

    return {
      title: "Dependency Report",
      summary: "DependencyAgent evaluated manifest sprawl and dependency governance signals.",
      findings,
      recommendations,
      riskLevel: findings.length >= 2 ? "medium" : findings.length === 1 ? "low" : "low"
    };
  }
}
