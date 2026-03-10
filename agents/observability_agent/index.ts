import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class ObservabilityAgent extends BaseAgent {
  constructor() {
    super("observability-agent", "observability_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;

    if (discovery.logging.frameworks.length === 0) {
      findings.push("No dedicated logging framework was detected.");
      recommendations.push("Adopt structured application logging with correlation-friendly fields.");
    }

    if (discovery.metrics.tools.length === 0) {
      findings.push("No metrics or tracing integration was detected.");
      recommendations.push("Instrument core request, job, and database paths with metrics or traces.");
    }

    if (!discovery.metrics.alertsConfigured) {
      findings.push("No alerting configuration was detected.");
      recommendations.push("Define alert thresholds for latency, error rate, and infrastructure saturation.");
    }

    return {
      title: "Observability Report",
      summary: "ObservabilityAgent checked logging, metrics, and alert readiness.",
      findings,
      recommendations,
      riskLevel: findings.length >= 2 ? "medium" : findings.length === 1 ? "low" : "low"
    };
  }
}
