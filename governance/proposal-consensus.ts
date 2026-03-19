import type {
  AgentReport,
  ProposalConsensusState
} from "../shared/types";

export interface ProposalConsensus {
  consensusScore: number;
  consensusState: ProposalConsensusState;
  supportingAgents: string[];
  consensusThemes: string[];
}

const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: "tests", pattern: /\b(test|coverage|regression|smoke|qa)\b/i },
  { theme: "ci", pattern: /\b(ci|pipeline|quality gate|workflow)\b/i },
  { theme: "logging", pattern: /\b(logging|logger|structured log)\b/i },
  { theme: "telemetry", pattern: /\b(metric|telemetry|tracing|alert)\b/i },
  { theme: "api", pattern: /\b(api|openapi|swagger|contract|schema)\b/i },
  { theme: "security", pattern: /\b(security|auth|secret|dependency|vulnerab|permission|compliance)\b/i },
  { theme: "architecture", pattern: /\b(architecture|coupling|boundary|module|refactor|maintainab|drift)\b/i },
  { theme: "documentation", pattern: /\b(doc|runbook|onboarding|readme|guide)\b/i },
  { theme: "performance", pattern: /\b(performance|latency|memory|cpu|bloat|hotspot|optimi)\b/i },
  { theme: "ux", pattern: /\b(ux|ui|usability|workflow|operator|experience)\b/i }
];

function extractThemes(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const matches = THEME_RULES
    .filter((rule) => rule.pattern.test(normalized))
    .map((rule) => rule.theme);

  return [...new Set(matches)];
}

function themesForReport(report: AgentReport): Set<string> {
  return new Set(
    [...report.findings, ...report.recommendations, report.summary].flatMap((entry) => extractThemes(entry))
  );
}

export function assessProposalConsensus(
  proposalText: string,
  sourceAgentId: string,
  agentReports: AgentReport[]
): ProposalConsensus {
  const proposalThemes = extractThemes(proposalText);
  if (proposalThemes.length === 0) {
    return {
      consensusScore: 0,
      consensusState: "weak",
      supportingAgents: [],
      consensusThemes: []
    };
  }

  const peers = agentReports.filter((report) => report.agentId !== sourceAgentId);
  const supporters: string[] = [];
  const overlapThemes = new Set<string>();

  for (const report of peers) {
    const reportThemes = themesForReport(report);
    const overlap = proposalThemes.filter((theme) => reportThemes.has(theme));

    if (overlap.length === 0) {
      continue;
    }

    supporters.push(report.agentId);
    for (const theme of overlap) {
      overlapThemes.add(theme);
    }
  }

  const consensusScore = peers.length === 0 ? 1 : supporters.length / peers.length;
  const consensusState: ProposalConsensusState =
    consensusScore >= 0.67 || supporters.length >= 2
      ? "strong"
      : consensusScore >= 0.34 || supporters.length >= 1
        ? "moderate"
        : "weak";

  return {
    consensusScore,
    consensusState,
    supportingAgents: supporters.sort((left, right) => left.localeCompare(right)),
    consensusThemes: [...overlapThemes].sort((left, right) => left.localeCompare(right))
  };
}
