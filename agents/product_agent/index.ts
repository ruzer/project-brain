import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class ProductAgent extends BaseAgent {
  constructor() {
    super("product-agent", "product_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;

    if (!discovery.files.some((file) => file.toLowerCase() === "readme.md")) {
      findings.push("Repository onboarding starts without a root README.");
      recommendations.push("Create a concise README with setup, architecture, and operating flows.");
    }

    if (discovery.ci.providers.length === 0) {
      findings.push("No CI/CD pipeline was detected, which increases operational friction.");
      recommendations.push("Introduce a CI baseline that runs quality gates on every change.");
    }

    if (discovery.apis.includes("REST") && !discovery.apis.includes("OpenAPI")) {
      findings.push("REST surfaces exist without a visible API contract.");
      recommendations.push("Publish and version an OpenAPI contract for developer and product alignment.");
    }

    if (discovery.structure.subrepos.length > 1 && !discovery.files.some((file) => file.startsWith("docs/"))) {
      findings.push("The repository appears multi-package but lacks navigational product documentation.");
      recommendations.push("Document bounded contexts, ownership, and cross-package workflows.");
    }

    return {
      title: "Improvement Proposals",
      summary: `Identified ${findings.length || 1} product and delivery opportunities across the repository.`,
      findings,
      recommendations,
      riskLevel: findings.length >= 3 ? "medium" : "low"
    };
  }
}
