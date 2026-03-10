import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class LegalAgent extends BaseAgent {
  constructor() {
    super("legal-agent", "legal_updates.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;
    const lowerFiles = discovery.files.map((file) => file.toLowerCase());

    if (!lowerFiles.includes("license") && !lowerFiles.includes("license.md")) {
      findings.push("No repository license file was detected.");
      recommendations.push("Add an explicit project license and document any distribution constraints.");
    }

    if (!lowerFiles.some((file) => file.includes("notice") || file.includes("third_party"))) {
      findings.push("No third-party notice or attribution artifact was detected.");
      recommendations.push("Generate a dependency attribution file for compliance and due diligence.");
    }

    if (discovery.dependencies.length > 0) {
      recommendations.push("Run a dependency license audit as part of the release workflow.");
    }

    return {
      title: "Legal Updates",
      summary: "LegalAgent reviewed licensing and attribution hygiene signals.",
      findings,
      recommendations,
      riskLevel: findings.length >= 2 ? "medium" : findings.length === 1 ? "low" : "low"
    };
  }
}
