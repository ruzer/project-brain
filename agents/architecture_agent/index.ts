import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class ArchitectureAgent extends BaseAgent {
  constructor() {
    super("architecture-agent", "architecture_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;

    if (discovery.structure.subrepos.length > 2) {
      findings.push("Multiple nested packages suggest growing architectural complexity.");
      recommendations.push("Define explicit module boundaries and ownership across nested packages.");
    }

    if (discovery.languages.length > 2) {
      findings.push("Polyglot architecture detected with potential coordination overhead.");
      recommendations.push("Document cross-runtime contracts and integration ownership.");
    }

    if (discovery.infrastructure.includes("Kubernetes") && discovery.ci.providers.length === 0) {
      findings.push("Operational infrastructure exists without visible release orchestration controls.");
      recommendations.push("Introduce deployment governance and architecture runbooks for cluster changes.");
    }

    if (discovery.structure.topLevelDirectories.length > 8 && !discovery.files.some((file) => file.startsWith("docs/architecture"))) {
      findings.push("Repository surface is broad but architecture documentation is shallow.");
      recommendations.push("Maintain a living architecture map with bounded contexts and critical data flows.");
    }

    return {
      title: "Architecture Report",
      summary: "ArchitectureAgent evaluated structure, boundaries, and architectural drift signals.",
      findings,
      recommendations,
      riskLevel: findings.length >= 3 ? "high" : findings.length >= 1 ? "medium" : "low"
    };
  }
}
