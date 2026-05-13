import type {
  AgentReport,
  ProposalConsensusState
} from "../shared/types";

export interface ProposalConsensus {
  consensusScore: number;
  consensusState: ProposalConsensusState;
  supportingAgents: string[];
  consensusThemes: string[];
  evidenceRefs: string[];
  contradictions: string[];
  confidenceMethod: "lexical" | "structural";
}

const THEME_RULES: Array<{ theme: string; pattern: RegExp }> = [
  { theme: "tests", pattern: /\b(tests?|coverage|regression|smoke|qa)\b/i },
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

function reportText(report: AgentReport): string {
  return [...report.findings, ...report.recommendations, report.summary].join("\n");
}

function extractEvidenceRefs(text: string): string[] {
  const matches = [
    ...text.matchAll(/(?:^|[\s`(])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|ya?ml|css|scss|py|go|rs))/g)
  ];

  return [...new Set(
    matches
      .map((match) => match[1]?.trim().replace(/[),.;:`]+$/g, ""))
      .filter(Boolean) as string[]
  )].sort((left, right) => left.localeCompare(right));
}

function hasContradiction(text: string): boolean {
  return /\b(no issue|not an issue|false positive|not reproducible|no evidence|sin evidencia|falso positivo|no confirmado)\b/i.test(text);
}

export function structuralConsensus(
  proposalText: string,
  sourceAgentId: string,
  agentReports: AgentReport[]
): ProposalConsensus {
  const proposalThemes = extractThemes(proposalText);
  const proposalRefs = extractEvidenceRefs(proposalText);
  const peers = agentReports.filter((report) => report.agentId !== sourceAgentId);

  if (proposalThemes.length === 0 || proposalRefs.length === 0) {
    return {
      consensusScore: 0,
      consensusState: "weak",
      supportingAgents: [],
      consensusThemes: [],
      evidenceRefs: proposalRefs,
      contradictions: [],
      confidenceMethod: "structural"
    };
  }

  const supportingAgents = new Set<string>();
  const consensusThemes = new Set<string>();
  const evidenceRefs = new Set<string>();
  const contradictions = new Set<string>();

  for (const report of peers) {
    const text = reportText(report);
    const reportThemes = themesForReport(report);
    const reportRefs = new Set(extractEvidenceRefs(text));
    const refOverlap = proposalRefs.filter((ref) => reportRefs.has(ref));
    const themeOverlap = proposalThemes.filter((theme) => reportThemes.has(theme));

    if (refOverlap.length === 0) {
      continue;
    }

    if (hasContradiction(text)) {
      contradictions.add(report.agentId);
      continue;
    }

    if (themeOverlap.length === 0) {
      continue;
    }

    supportingAgents.add(report.agentId);
    for (const ref of refOverlap) {
      evidenceRefs.add(ref);
    }
    for (const theme of themeOverlap) {
      consensusThemes.add(theme);
    }
  }

  const supporters = [...supportingAgents].sort((left, right) => left.localeCompare(right));
  const consensusScore = peers.length === 0 ? 0 : supporters.length / peers.length;
  const consensusState: ProposalConsensusState = supporters.length >= 2 ? "strong" : "weak";

  return {
    consensusScore,
    consensusState,
    supportingAgents: supporters,
    consensusThemes: [...consensusThemes].sort((left, right) => left.localeCompare(right)),
    evidenceRefs: [...evidenceRefs].sort((left, right) => left.localeCompare(right)),
    contradictions: [...contradictions].sort((left, right) => left.localeCompare(right)),
    confidenceMethod: "structural"
  };
}

export function assessProposalConsensus(
  proposalText: string,
  sourceAgentId: string,
  agentReports: AgentReport[]
): ProposalConsensus {
  const structural = structuralConsensus(proposalText, sourceAgentId, agentReports);
  if (structural.supportingAgents.length >= 2) {
    return structural;
  }

  const proposalThemes = extractThemes(proposalText);
  if (proposalThemes.length === 0) {
    return {
      consensusScore: 0,
      consensusState: "weak",
      supportingAgents: [],
      consensusThemes: [],
      evidenceRefs: structural.evidenceRefs,
      contradictions: structural.contradictions,
      confidenceMethod: "lexical"
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
  /**
   * Lexical consensus is a theme-based fallback. It is useful for broad agreement,
   * but it does not prove agents cited the same technical evidence.
   */
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
    consensusThemes: [...overlapThemes].sort((left, right) => left.localeCompare(right)),
    evidenceRefs: structural.evidenceRefs,
    contradictions: structural.contradictions,
    confidenceMethod: "lexical"
  };
}
