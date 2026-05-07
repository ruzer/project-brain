import { buildWorkflowRuntimeDefinitions } from "../workflow_registry";
import type { DoctorCheck, DoctorResult, ProjectContext, ResumeResult, StatusArtifactSummary, StatusResult, SuggestedAction } from "../../shared/types";

function uniqueSuggestions(actions: SuggestedAction[]): SuggestedAction[] {
  const seen = new Set<string>();
  const priorityRank: Record<SuggestedAction["priority"], number> = {
    high: 3,
    medium: 2,
    low: 1
  };

  return actions
    .filter((action) => {
      const key = action.command.trim() || action.label.trim();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const rankDelta = priorityRank[right.priority] - priorityRank[left.priority];
      return rankDelta !== 0 ? rankDelta : left.label.localeCompare(right.label);
    });
}

function outputFlag(context: ProjectContext): string {
  return `--output "${context.outputPath}"`;
}

function hasArtifact(artifacts: StatusArtifactSummary[], label: string): boolean {
  return artifacts.some((artifact) => artifact.label === label && artifact.exists);
}

function failedChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((check) => check.status === "fail");
}

function warningChecks(checks: DoctorCheck[]): DoctorCheck[] {
  return checks.filter((check) => check.status === "warn");
}

export function deriveDoctorSuggestions(result: Pick<DoctorResult, "context" | "checks" | "summary">): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const failed = failedChecks(result.checks);
  const warnings = warningChecks(result.checks);
  const output = outputFlag(result.context);

  if (failed.some((check) => check.id === "cli-build")) {
    actions.push({
      label: "Build CLI",
      command: "npm run build",
      rationale: "The built CLI artifact is missing, so runtime commands may fail.",
      priority: "high"
    });
  }

  if (failed.some((check) => check.id === "model-config")) {
    actions.push({
      label: "Restore Model Config",
      command: `project-brain models`,
      rationale: "The model config file is missing or unreadable.",
      priority: "high"
    });
  }

  if (failed.some((check) => check.id === "model-profiles")) {
    actions.push({
      label: "Repair Local Models",
      command: "project-brain models",
      rationale: "One or more critical model profiles are unavailable.",
      priority: "high"
    });
  }

  if (warnings.some((check) => check.id === "ollama-binary" || check.id === "ollama-api")) {
    actions.push({
      label: "Inspect Ollama",
      command: "project-brain models",
      rationale: "Local model execution is degraded or unavailable.",
      priority: "medium"
    });
  }

  if (warnings.some((check) => check.id === "git-repository")) {
    actions.push({
      label: "Map Outside Git",
      command: `project-brain map-codebase . ${output}`,
      rationale: "The target is not a git repo, so static mapping is the best next step.",
      priority: "medium"
    });
  }

  if (failed.length === 0) {
    actions.push({
      label: "Inspect Operational Status",
      command: `project-brain status . ${output}`,
      rationale: "The environment is healthy enough to inspect current artifacts and next steps.",
      priority: warnings.length > 0 ? "medium" : "low"
    });
  }

  return uniqueSuggestions(actions);
}

export function deriveStatusSuggestions(result: Pick<StatusResult, "context" | "summary" | "artifacts">): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const output = outputFlag(result.context);
  const workflows = buildWorkflowRuntimeDefinitions(result.context);
  const workflowById = new Map(workflows.map((workflow) => [workflow.workflowId, workflow]));

  if (result.summary.doctorStatus === "unknown") {
    actions.push({
      label: "Run Doctor",
      command: `project-brain doctor . ${output}`,
      rationale: "There is no doctor snapshot for this output path yet.",
      priority: "high"
    });
  } else if (result.summary.doctorStatus === "fail" || result.summary.doctorStatus === "warn") {
    actions.push({
      label: "Re-run Doctor",
      command: `project-brain doctor . ${output}`,
      rationale: "The latest doctor snapshot found issues or warnings that should be rechecked.",
      priority: result.summary.doctorStatus === "fail" ? "high" : "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Codebase Map")) {
    const workflow = workflowById.get("map-codebase");
    actions.push({
      label: workflow?.commandLabel ?? "Generate Codebase Map",
      command: workflow?.command ?? `project-brain map-codebase . ${output}`,
      rationale: workflow?.rationale ?? "The output path does not have a current structural map yet.",
      priority: workflow?.priority ?? "high"
    });
  }

  if (!hasArtifact(result.artifacts, "Memory Brief")) {
    actions.push({
      label: "Refresh Memory Brief",
      command: `project-brain status . ${output}`,
      rationale: "The compact memory handoff is missing; status refreshes project memory before deeper analysis.",
      priority: "high"
    });
  }

  if (!hasArtifact(result.artifacts, "Repository Fact Graph")) {
    const workflow = workflowById.get("code-graph");
    actions.push({
      label: workflow?.commandLabel ?? "Build Repository Fact Graph",
      command: workflow?.command ?? `project-brain code-graph . ${output}`,
      rationale: workflow?.rationale ?? "A factual graph gives later runs a compact structural index before spending tokens on broad model analysis.",
      priority: hasArtifact(result.artifacts, "Codebase Map") ? "high" : "medium"
    });
  }

  if (hasArtifact(result.artifacts, "Repository Fact Graph") && !hasArtifact(result.artifacts, "Fact Query")) {
    const workflow = workflowById.get("fact-query");
    actions.push({
      label: workflow?.commandLabel ?? "Query Factual Memory",
      command: workflow?.command ?? `project-brain fact-query "memory optimization" . ${output}`,
      rationale: workflow?.rationale ?? "A deterministic query gives agents a compact starting context before broad model analysis.",
      priority: workflow?.priority ?? "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Runbook")) {
    const workflow = workflowById.get("runbook");
    actions.push({
      label: workflow?.commandLabel ?? "Create Token-Aware Runbook",
      command: workflow?.command ?? `project-brain runbook "optimize analysis and cost" . ${output}`,
      rationale: workflow?.rationale ?? "A runbook orders deterministic memory, graph, query, governance, and swarm steps before expensive analysis.",
      priority: workflow?.priority ?? "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Harness Audit")) {
    const workflow = workflowById.get("harness-audit");
    actions.push({
      label: workflow?.commandLabel ?? "Audit Harness Readiness",
      command: workflow?.command ?? `project-brain harness-audit . ${output}`,
      rationale: workflow?.rationale ?? "A harness audit checks progressive memory, cost gates, and continuity before model-heavy work.",
      priority: workflow?.priority ?? "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Swarm")) {
    const workflow = workflowById.get("swarm");
    actions.push({
      label: workflow?.commandLabel ?? "Run Self Improve",
      command: workflow?.command ?? `project-brain self-improve . ${output}`,
      rationale: workflow?.rationale ?? "There is no swarm/self-improvement run in this output path yet.",
      priority: workflow?.priority ?? "high"
    });
  }

  if (!hasArtifact(result.artifacts, "Improvement Plan") && hasArtifact(result.artifacts, "Swarm")) {
    const workflow = workflowById.get("plan-improvements");
    actions.push({
      label: workflow?.commandLabel ?? "Build Improvement Plan",
      command: workflow?.command ?? `project-brain plan-improvements . ${output}`,
      rationale: workflow?.rationale ?? "You already have analysis artifacts, so the next useful step is a persistent roadmap.",
      priority: workflow?.priority ?? "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Firewall")) {
    const workflow = workflowById.get("firewall");
    actions.push({
      label: workflow?.commandLabel ?? "Inspect Firewall",
      command: workflow?.command ?? `project-brain firewall . --trigger repository-change ${output}`,
      rationale: workflow?.rationale ?? "There is no current agent policy snapshot in this output path.",
      priority: workflow?.priority ?? "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Impact Radius")) {
    const workflow = workflowById.get("review-delta");
    actions.push({
      label: workflow?.commandLabel ?? "Review Recent Changes",
      command: workflow?.command ?? `project-brain review-delta . ${output}`,
      rationale: workflow?.rationale ?? "There is no bounded review surface for recent git changes.",
      priority: workflow?.priority ?? "low"
    });
  }

  return uniqueSuggestions(actions);
}

export function deriveResumeSuggestions(
  result: Pick<ResumeResult, "context" | "summary" | "artifacts">,
  statusSuggestions: SuggestedAction[]
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const output = outputFlag(result.context);

  if (result.summary.stage === "bootstrap") {
    actions.push({
      label: "Run Doctor",
      command: `project-brain doctor . ${output}`,
      rationale: "There is no resumable output state yet, so doctor is the safest bootstrap step.",
      priority: "high"
    });
  }

  if (result.summary.stage === "start" && !hasArtifact(result.artifacts, "Swarm")) {
    actions.push({
      label: "Continue With Cheap Swarm",
      command: `project-brain swarm "optimize analysis and cost" . ${output} --preset cheap`,
      rationale: "The guided start path prepared cheap context; the next optional step is bounded delegated analysis.",
      priority: "high"
    });
  }

  if (result.summary.stage === "doctor" && !hasArtifact(result.artifacts, "Codebase Map")) {
    actions.push({
      label: "Continue With Discovery",
      command: `project-brain map-codebase . ${output}`,
      rationale: "Doctor is complete, but structural discovery has not been generated yet.",
      priority: "high"
    });
  }

  if ((result.summary.stage === "map-codebase" || result.summary.stage === "ask") && !hasArtifact(result.artifacts, "Swarm")) {
    if (!hasArtifact(result.artifacts, "Repository Fact Graph")) {
      actions.push({
        label: "Continue With Fact Graph",
        command: `project-brain code-graph . ${output}`,
        rationale: "Structural facts are available from deterministic analysis and should be captured before a bounded swarm run.",
        priority: "high"
      });
    }

    actions.push({
      label: "Continue With Swarm",
      command: `project-brain self-improve . ${output}`,
      rationale: "The repo already has discovery context, so the next useful step is a bounded delegated analysis.",
      priority: "high"
    });
  }

  if (result.summary.stage === "fact-query" && !hasArtifact(result.artifacts, "Runbook")) {
    actions.push({
      label: "Continue With Runbook",
      command: `project-brain runbook "optimize analysis and cost" . ${output}`,
      rationale: "Filtered memory exists; the next useful step is an ordered low-cost execution plan.",
      priority: "high"
    });
  }

  if (result.summary.stage === "runbook" && !hasArtifact(result.artifacts, "Harness Audit")) {
    actions.push({
      label: "Continue With Harness Audit",
      command: `project-brain harness-audit . ${output}`,
      rationale: "A runbook exists; audit memory and cost gates before model-heavy work.",
      priority: "high"
    });
  }

  if (result.summary.stage === "harness-audit" && !hasArtifact(result.artifacts, "Firewall")) {
    actions.push({
      label: "Continue With Firewall",
      command: `project-brain firewall . --trigger repository-change ${output}`,
      rationale: "Harness readiness exists; inspect governance boundaries before delegated analysis.",
      priority: "high"
    });
  }

  if (result.summary.stage === "swarm" && !hasArtifact(result.artifacts, "Improvement Plan")) {
    actions.push({
      label: "Continue With Improvement Plan",
      command: `project-brain plan-improvements . ${output}`,
      rationale: "A swarm run already exists, so the next step is to convert findings into a persistent roadmap.",
      priority: "high"
    });
  }

  if (result.summary.stage === "plan-improvements" && !hasArtifact(result.artifacts, "Impact Radius")) {
    actions.push({
      label: "Review Latest Changes",
      command: `project-brain review-delta . ${output}`,
      rationale: "A plan exists already; the next useful checkpoint is a bounded review of recent changes.",
      priority: "medium"
    });
  }

  return uniqueSuggestions([...actions, ...statusSuggestions]);
}
