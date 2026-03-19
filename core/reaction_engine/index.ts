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
    actions.push({
      label: "Generate Codebase Map",
      command: `project-brain map-codebase . ${output}`,
      rationale: "The output path does not have a current structural map yet.",
      priority: "high"
    });
  }

  if (!hasArtifact(result.artifacts, "Swarm")) {
    actions.push({
      label: "Run Self Improve",
      command: `project-brain self-improve . ${output}`,
      rationale: "There is no swarm/self-improvement run in this output path yet.",
      priority: "high"
    });
  }

  if (!hasArtifact(result.artifacts, "Improvement Plan") && hasArtifact(result.artifacts, "Swarm")) {
    actions.push({
      label: "Build Improvement Plan",
      command: `project-brain plan-improvements . ${output}`,
      rationale: "You already have analysis artifacts, so the next useful step is a persistent roadmap.",
      priority: "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Firewall")) {
    actions.push({
      label: "Inspect Firewall",
      command: `project-brain firewall . --trigger repository-change ${output}`,
      rationale: "There is no current agent policy snapshot in this output path.",
      priority: "medium"
    });
  }

  if (!hasArtifact(result.artifacts, "Impact Radius")) {
    actions.push({
      label: "Review Recent Changes",
      command: `project-brain review-delta . ${output}`,
      rationale: "There is no bounded review surface for recent git changes.",
      priority: "low"
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

  if (result.summary.stage === "doctor" && !hasArtifact(result.artifacts, "Codebase Map")) {
    actions.push({
      label: "Continue With Discovery",
      command: `project-brain map-codebase . ${output}`,
      rationale: "Doctor is complete, but structural discovery has not been generated yet.",
      priority: "high"
    });
  }

  if ((result.summary.stage === "map-codebase" || result.summary.stage === "ask") && !hasArtifact(result.artifacts, "Swarm")) {
    actions.push({
      label: "Continue With Swarm",
      command: `project-brain self-improve . ${output}`,
      rationale: "The repo already has discovery context, so the next useful step is a bounded delegated analysis.",
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
