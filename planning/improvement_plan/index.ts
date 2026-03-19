import path from "node:path";

import { ensureDir, uniqueSorted, writeFileEnsured } from "../../shared/fs-utils";
import type {
  AgentReport,
  ContextAnnotation,
  GovernanceSummary,
  ImprovementPlanResult,
  ProjectContext,
  ProposalArtifact
} from "../../shared/types";

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function rankBucket(proposal: ProposalArtifact): "Now" | "Next" | "Later" {
  if (
    proposal.riskLevel === "high" ||
    proposal.status === "REQUIRES_HUMAN_REVIEW" ||
    proposal.consensusState === "strong"
  ) {
    return "Now";
  }

  if (proposal.status === "APPROVED" || proposal.consensusState === "moderate") {
    return "Next";
  }

  return "Later";
}

function detectTrack(proposal: ProposalArtifact): string {
  const text = `${proposal.title} ${proposal.summary} ${proposal.expectedBenefit} ${proposal.consensusThemes.join(" ")}`.toLowerCase();

  if (/\b(test|coverage|qa|regression|smoke)\b/.test(text)) {
    return "Quality";
  }
  if (/\b(security|auth|secret|dependency|compliance|permission)\b/.test(text)) {
    return "Security";
  }
  if (/\b(metric|telemetry|logging|observability|tracing|alert)\b/.test(text)) {
    return "Observability";
  }
  if (/\b(ux|ui|workflow|usability|operator)\b/.test(text)) {
    return "Experience";
  }
  if (/\b(architecture|module|boundary|refactor|maintainab|drift)\b/.test(text)) {
    return "Architecture";
  }
  if (/\b(doc|runbook|readme|guide|onboarding)\b/.test(text)) {
    return "Documentation";
  }

  return "Platform";
}

function summarizeRisk(report: AgentReport): string[] {
  return report.findings.slice(0, 3).map((finding) => `${report.agentId} | ${finding}`);
}

function summarizeProposal(proposal: ProposalArtifact): string {
  return `${proposal.title} | status=${proposal.status} | consensus=${proposal.consensusState} (${proposal.consensusScore.toFixed(2)}) | risk=${proposal.riskLevel}`;
}

export async function writeImprovementPlanArtifacts(
  context: ProjectContext,
  agentReports: AgentReport[],
  governanceSummary: GovernanceSummary,
  annotations: ContextAnnotation[]
): Promise<ImprovementPlanResult> {
  const planDir = path.join(context.docsDir, "improvement_plan");
  const summaryPath = path.join(planDir, "SUMMARY.md");
  const statePath = path.join(planDir, "STATE.md");
  const risksPath = path.join(planDir, "KNOWN_RISKS.md");
  const roadmapPath = path.join(planDir, "ROADMAP.md");
  const tracksPath = path.join(planDir, "TRACKS.md");

  await ensureDir(planDir);

  const proposals = governanceSummary.proposals;
  const now = proposals.filter((proposal) => rankBucket(proposal) === "Now");
  const next = proposals.filter((proposal) => rankBucket(proposal) === "Next");
  const later = proposals.filter((proposal) => rankBucket(proposal) === "Later");

  const groupedTracks = new Map<string, ProposalArtifact[]>();
  for (const proposal of proposals) {
    const track = detectTrack(proposal);
    groupedTracks.set(track, [...(groupedTracks.get(track) ?? []), proposal]);
  }

  const highRiskReports = agentReports.filter((report) => report.riskLevel === "high");
  const mediumRiskReports = agentReports.filter((report) => report.riskLevel === "medium");
  const annotationLines = annotations.map((annotation) => `[${annotation.scope}] ${annotation.note}`);
  const firewall = governanceSummary.firewall;

  await writeFileEnsured(
    summaryPath,
    `# Improvement Plan Summary

## Current posture

- Repository: ${context.repoName}
- Languages: ${context.discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${context.discovery.frameworks.join(", ") || "Unknown"}
- Trigger: ${governanceSummary.trigger}
- Agent reports: ${agentReports.length}
- Proposals: ${proposals.length}
- Firewall review gates: ${firewall?.stats.reviewRequired ?? 0}

## Top actions now

${renderList(now.slice(0, 5).map(summarizeProposal))}

## Suggested next commands

${renderList([
  'project-brain ask "dime que le falta criticamente"',
  'project-brain swarm "ayudame a mejorar este repo"',
  'project-brain review-delta .',
  'project-brain firewall . --trigger repository-change'
])}
`
  );

  await writeFileEnsured(
    statePath,
    `# State

## Snapshot

- Repository: ${context.repoName}
- Generated at: ${new Date().toISOString()}
- Languages: ${context.discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${context.discovery.frameworks.join(", ") || "Unknown"}
- APIs: ${context.discovery.apis.join(", ") || "Not detected"}
- Testing: ${context.discovery.testing.join(", ") || "Not detected"}
- Infrastructure: ${context.discovery.infrastructure.join(", ") || "Not detected"}
- CI/CD: ${context.discovery.ci.providers.join(", ") || "Not detected"}
- Structured logging: ${context.discovery.logging.structured ? "Detected" : "Not detected"}
- Metrics: ${context.discovery.metrics.tools.join(", ") || "Not detected"}

## Governance posture

- Approved proposals: ${proposals.filter((proposal) => proposal.status === "APPROVED").length}
- Human-review proposals: ${proposals.filter((proposal) => proposal.status === "REQUIRES_HUMAN_REVIEW").length}
- Rejected proposals: ${proposals.filter((proposal) => proposal.status === "REJECTED").length}
- Firewall allowed: ${firewall?.stats.allowed ?? 0}
- Firewall review-required: ${firewall?.stats.reviewRequired ?? 0}
- Firewall blocked: ${firewall?.stats.blocked ?? 0}

## Local annotations

${renderList(annotationLines)}
`
  );

  await writeFileEnsured(
    risksPath,
    `# Known Risks

## High risk

${renderList(highRiskReports.flatMap(summarizeRisk))}

## Medium risk

${renderList(mediumRiskReports.flatMap(summarizeRisk))}

## Proposal-level risks

${renderList(
        proposals.map(
          (proposal) =>
            `${proposal.title} | risk=${proposal.riskLevel} | status=${proposal.status} | files=${proposal.affectedFiles.join(", ") || "None"}`
        )
      )}
`
  );

  await writeFileEnsured(
    roadmapPath,
    `# Roadmap

## Now

${renderList(now.map((proposal) => `${summarizeProposal(proposal)} | files=${proposal.affectedFiles.join(", ") || "None"}`))}

## Next

${renderList(next.map((proposal) => `${summarizeProposal(proposal)} | files=${proposal.affectedFiles.join(", ") || "None"}`))}

## Later

${renderList(later.map((proposal) => `${summarizeProposal(proposal)} | files=${proposal.affectedFiles.join(", ") || "None"}`))}
`
  );

  await writeFileEnsured(
    tracksPath,
    `# Tracks

${[...groupedTracks.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([track, trackProposals]) => `## ${track}

- Proposal count: ${trackProposals.length}
- Files: ${uniqueSorted(trackProposals.flatMap((proposal) => proposal.affectedFiles)).join(", ") || "None"}

${renderList(trackProposals.map((proposal) => `${proposal.title} | agent=${proposal.agentId} | status=${proposal.status}`))}
`
        )
        .join("\n")}
`
  );

  return {
    context,
    planDir,
    summaryPath,
    statePath,
    risksPath,
    roadmapPath,
    tracksPath
  };
}
