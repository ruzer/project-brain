import type { AgentEvaluationScore, AgentReport, AgentTask, RiskLevel } from "../shared/types";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function riskWeight(riskLevel: RiskLevel): number {
  if (riskLevel === "high") {
    return 1;
  }
  if (riskLevel === "medium") {
    return 0.75;
  }
  return 0.5;
}

export class AgentEvaluator {
  evaluate(task: AgentTask, report: AgentReport): AgentEvaluationScore {
    const findingsWeight = Math.min(report.findings.length, 4) / 4;
    const recommendationWeight = Math.min(report.recommendations.length, 4) / 4;
    const outputQuality = clamp(0.35 + findingsWeight * 0.35 + recommendationWeight * 0.3);
    const proposalQuality = clamp(report.recommendations.length === 0 ? 0.3 : 0.5 + recommendationWeight * 0.5);
    const signalStrength = clamp(0.3 + findingsWeight * 0.4 + riskWeight(report.riskLevel) * 0.3);
    const riskAlignment = clamp(
      report.riskLevel === "high"
        ? 0.6 + findingsWeight * 0.4
        : report.riskLevel === "medium"
          ? 0.55 + findingsWeight * 0.3
          : 0.5 + recommendationWeight * 0.2
    );
    const overallScore = clamp((outputQuality + proposalQuality + signalStrength + riskAlignment) / 4);
    const notes: string[] = [];

    if (report.findings.length === 0) {
      notes.push("Low finding density; monitor for missed issues.");
    }
    if (report.recommendations.length === 0) {
      notes.push("No improvement proposals generated.");
    }
    if (report.riskLevel === "high") {
      notes.push("High-risk output should be prioritized for human review.");
    }

    return {
      agentId: report.agentId,
      taskId: task.taskId,
      outputQuality,
      proposalQuality,
      signalStrength,
      riskAlignment,
      overallScore,
      rank: 0,
      notes
    };
  }

  rank(scores: AgentEvaluationScore[]): AgentEvaluationScore[] {
    const sorted = [...scores].sort((left, right) => right.overallScore - left.overallScore);
    return sorted.map((score, index) => ({
      ...score,
      rank: index + 1
    }));
  }
}
