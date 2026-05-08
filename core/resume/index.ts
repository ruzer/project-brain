import path from "node:path";

import { buildStatus } from "../status";
import { deriveResumeSuggestions } from "../reaction_engine";
import { workflowForArtifactLabel } from "../workflow_registry";
import { writeExecutiveSummaryArtifacts } from "../../memory/executive_summary";
import { readJsonSafe, readTextSafe, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectContext, ResumeResult, ResumeStage, StatusArtifactSummary, StatusResult } from "../../shared/types";

interface ResumeDeps {
  buildStatus?: (context: ProjectContext) => Promise<StatusResult>;
}

function artifactPriority(label: string): number {
  return workflowForArtifactLabel(label)?.resumePriority ?? 0;
}

function latestArtifact(artifacts: StatusArtifactSummary[]): StatusArtifactSummary | undefined {
  return artifacts
    .filter((artifact) => artifact.exists && artifact.updatedAt)
    .sort((left, right) => {
      const priorityDelta = artifactPriority(right.label) - artifactPriority(left.label);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? "");
    })[0];
}

function stageFromArtifactLabel(label: string | undefined): ResumeStage {
  const stage = label ? workflowForArtifactLabel(label)?.resumeStage : undefined;
  return stage ?? "bootstrap";
}

function firstUsefulLines(input: string, limit = 2): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^#/.test(line))
    .slice(0, limit);
}

async function buildStageNotes(
  context: ProjectContext,
  stage: ResumeStage,
  latest: StatusArtifactSummary | undefined,
  status: StatusResult
): Promise<string[]> {
  const notes: string[] = [];

  if (!latest) {
    notes.push("No resumable project-brain artifacts were found in this output path yet.");
    if (status.git.isGitRepo) {
      notes.push("The target is a git repository, so doctor or map-codebase are the best bootstrap steps.");
    }
    return notes;
  }

  notes.push(`Latest artifact: ${latest.label}${latest.updatedAt ? ` at ${latest.updatedAt}` : ""}.`);

  if (status.summary.doctorStatus !== "unknown") {
    notes.push(`Doctor status: ${status.summary.doctorStatus}.`);
  }

  if (stage === "doctor") {
    const doctor = await readJsonSafe<{ summary?: { headline?: string } }>(path.join(context.memoryDir, "doctor", "doctor.json"));
    if (doctor?.summary?.headline) {
      notes.push(doctor.summary.headline);
    }
  }

  if (stage === "start") {
    const start = await readJsonSafe<{ headline?: string; nextCommand?: string }>(path.join(context.memoryDir, "start", "start.json"));
    if (start?.headline) {
      notes.push(start.headline);
    }
    if (start?.nextCommand) {
      notes.push(`Start next command: ${start.nextCommand}`);
    }
  }

  if (stage === "swarm") {
    const swarm = await readJsonSafe<{
      synthesis?: { headline?: string; summary?: string };
      resilience?: { runTimedOut?: boolean; timedOutTasks?: number };
    }>(path.join(context.memoryDir, "swarm", "swarm_run.json"));
    if (swarm?.synthesis?.headline) {
      notes.push(swarm.synthesis.headline);
    }
    if (swarm?.resilience?.runTimedOut) {
      notes.push(`The last swarm run exhausted its global time budget${swarm.resilience.timedOutTasks ? ` with ${swarm.resilience.timedOutTasks} timed-out tasks` : ""}.`);
    } else if (swarm?.synthesis?.summary) {
      notes.push(swarm.synthesis.summary);
    }
  }

  if (stage === "plan-improvements") {
    const lines = firstUsefulLines(await readTextSafe(path.join(context.docsDir, "improvement_plan", "SUMMARY.md")));
    if (lines.length > 0) {
      notes.push(...lines);
    } else {
      notes.push("An improvement plan is already present for this output path.");
    }
  }

  if (stage === "map-codebase") {
    const codebaseMap = status.artifacts.find((artifact) => artifact.label === "Codebase Map" && artifact.exists);
    const lines = codebaseMap ? firstUsefulLines(await readTextSafe(path.join(context.docsDir, "codebase_map", "SUMMARY.md"))) : [];
    if (lines.length > 0) {
      notes.push(...lines);
    } else if (codebaseMap) {
      notes.push("A codebase map is already present for this output path.");
    } else {
      notes.push("A codebase map is still missing for this output path.");
    }

    const factGraph = status.artifacts.find((artifact) => artifact.label === "Repository Fact Graph" && artifact.exists);
    if (factGraph) {
      notes.push("A repository fact graph is available and should be reused before running broad model analysis.");
    }

    const memoryBrief = status.artifacts.find((artifact) => artifact.label === "Memory Brief" && artifact.exists);
    if (memoryBrief) {
      notes.push("A compact memory brief is available for agents and future model handoffs.");
    }
  }

  if (stage === "fact-query") {
    const lines = firstUsefulLines(await readTextSafe(path.join(context.reportsDir, "fact_query.md")), 3);
    if (lines.length > 0) {
      notes.push(...lines);
    }
    notes.push("A factual memory query is available; use it before broad swarm analysis.");
  }

  if (stage === "runbook") {
    const lines = firstUsefulLines(await readTextSafe(path.join(context.reportsDir, "runbook.md")), 3);
    if (lines.length > 0) {
      notes.push(...lines);
    }
    notes.push("A token-aware runbook exists; continue with its first non-done step.");
  }

  if (stage === "harness-audit") {
    const audit = await readJsonSafe<{ score?: number; tokenRisk?: string; suggestedCommands?: string[] }>(
      path.join(context.memoryDir, "harness_audit", "harness_audit.json")
    );
    if (audit) {
      notes.push(`Harness audit: score=${audit.score ?? "unknown"}, tokenRisk=${audit.tokenRisk ?? "unknown"}.`);
      if (audit.suggestedCommands && audit.suggestedCommands.length > 0) {
        notes.push(`Harness next command: ${audit.suggestedCommands[0]}`);
      }
    } else {
      notes.push("A harness audit exists; use it to confirm memory, cost gates, and continuity before model-heavy work.");
    }
  }

  if (stage === "ask") {
    const lines = firstUsefulLines(await readTextSafe(path.join(context.reportsDir, "ask_brief.md")));
    if (lines.length > 0) {
      notes.push(...lines);
    } else {
      notes.push("An ask brief already exists for this output path.");
    }
  }

  if (stage === "firewall") {
    notes.push("An agent firewall snapshot exists and can be reused as the current safety baseline.");
  }

  if (stage === "review-delta") {
    notes.push("A recent impact review already exists for this output path.");
  }

  const missingArtifacts = status.artifacts.filter((artifact) => !artifact.exists).map((artifact) => artifact.label);
  if (missingArtifacts.length > 0) {
    const preview = missingArtifacts.slice(0, 4);
    notes.push(
      missingArtifacts.length > preview.length
        ? `Missing artifacts: ${preview.join(", ")}, plus more.`
        : `Missing artifacts: ${preview.join(", ")}.`
    );
  }

  return notes;
}

function buildResumeHeadline(stage: ResumeStage, latest: StatusArtifactSummary | undefined, notes: string[]): string {
  if (!latest) {
    return "No resumable project-brain artifacts were found in this output path.";
  }

  if (stage === "swarm" && notes.length > 1) {
    return `Resume from Swarm: ${notes[1]}`;
  }

  if (stage === "start") {
    return "Resume from Start: the guided path already prepared the project context.";
  }

  if (stage === "plan-improvements") {
    return "Resume from Improvement Plan: a persistent roadmap already exists for this output path.";
  }

  if (stage === "map-codebase") {
    return "Resume from Codebase Map: structural discovery is already in place.";
  }

  if (stage === "fact-query") {
    return "Resume from Fact Query: filtered factual memory is ready for the next analysis step.";
  }

  if (stage === "runbook") {
    return "Resume from Runbook: a token-aware execution path is ready.";
  }

  if (stage === "harness-audit") {
    return "Resume from Harness Audit: memory and cost readiness have been checked.";
  }

  if (stage === "doctor") {
    return "Resume from Doctor: environment checks are complete and the repo is ready for deeper analysis.";
  }

  return `Resume from ${latest.label}: project-brain found a persisted checkpoint to continue from.`;
}

function renderArtifacts(artifacts: StatusArtifactSummary[]): string {
  return artifacts
    .map((artifact) => {
      const updated = artifact.updatedAt ? ` | updated=${artifact.updatedAt}` : "";
      return `- ${artifact.label}: ${artifact.exists ? "present" : "missing"} | ${artifact.path}${updated}`;
    })
    .join("\n");
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderSuggestions(result: ResumeResult): string {
  return result.suggestions.length > 0
    ? result.suggestions
        .map(
          (suggestion) => `### ${suggestion.label}

- Priority: ${suggestion.priority.toUpperCase()}
- Command: \`${suggestion.command}\`
- Rationale: ${suggestion.rationale}`
        )
        .join("\n\n")
    : "No immediate follow-up actions suggested.";
}

function renderResumeReport(result: ResumeResult): string {
  return `# Resume

## Summary

- Repository: ${result.context.repoName}
- Target: ${result.context.targetPath}
- Output: ${result.context.outputPath}
- Git repo: ${result.git.isGitRepo ? "yes" : "no"}
- Branch: ${result.git.branch ?? "unknown"}
- Stage: ${result.summary.stage}
- Memory readiness: ${result.memoryReadiness.status} (${result.memoryReadiness.reason})
- Executive summary: ${result.executiveSummary.reportPath}
- Artifact count: ${result.summary.artifactCount}
- Latest artifact: ${result.summary.latestArtifactLabel ?? "none"}${result.summary.latestArtifactUpdatedAt ? ` (${result.summary.latestArtifactUpdatedAt})` : ""}
- Headline: ${result.summary.headline}

## Notes

${renderList(result.notes)}

## Artifacts

${renderArtifacts(result.artifacts)}

## Suggested Actions

${renderSuggestions(result)}
`;
}

export async function buildResume(context: ProjectContext, deps: ResumeDeps = {}): Promise<ResumeResult> {
  const status = deps.buildStatus ? await deps.buildStatus(context) : await buildStatus(context);
  const executiveSummary = status.executiveSummary ?? await writeExecutiveSummaryArtifacts(context);
  const latest = latestArtifact(status.artifacts);
  const stage = stageFromArtifactLabel(latest?.label);
  const notes = await buildStageNotes(context, stage, latest, status);
  const summary: ResumeResult["summary"] = {
    headline: buildResumeHeadline(stage, latest, notes),
    stage,
    artifactCount: status.summary.artifactCount,
    latestArtifactLabel: latest?.label,
    latestArtifactUpdatedAt: latest?.updatedAt
  };
  const suggestions = deriveResumeSuggestions(
    {
      context,
      summary,
      artifacts: status.artifacts
    },
    status.suggestions
  );

  const reportPath = path.join(context.reportsDir, "resume.md");
  const memoryPath = path.join(context.memoryDir, "resume", "resume.json");

  const result: ResumeResult = {
    context,
    reportPath,
    memoryPath,
    git: status.git,
    summary,
    latestArtifact: latest,
    memoryReadiness: status.memoryReadiness,
    executiveSummary,
    artifacts: status.artifacts,
    notes,
    suggestions
  };

  await writeFileEnsured(reportPath, renderResumeReport(result));
  await writeJsonEnsured(memoryPath, {
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    git: result.git,
    summary,
    latestArtifact: latest,
    memoryReadiness: status.memoryReadiness,
    executiveSummary: {
      reportPath: executiveSummary.reportPath,
      memoryPath: executiveSummary.memoryPath,
      status: executiveSummary.status
    },
    artifacts: result.artifacts,
    notes,
    suggestions
  });

  return result;
}
