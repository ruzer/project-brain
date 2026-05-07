import path from "node:path";
import { promises as fs } from "node:fs";

import { deriveStatusSuggestions } from "../reaction_engine";
import { buildWorkflowRuntimeDefinitions } from "../workflow_registry";
import { assessMemoryReadiness } from "../../memory/readiness";
import { fileExists, readJsonSafe, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { DoctorCheckStatus, ProjectContext, StatusArtifactSummary, StatusResult, SuggestedAction } from "../../shared/types";

interface StatusDeps {
  runCommand?: (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<{
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
  }>;
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }> {
  const { spawn } = await import("node:child_process");

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    child.stdout.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));

    const timeout = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs)
      : undefined;

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        ok: false,
        stdout: "",
        stderr: error.message,
        exitCode: null
      });
    });

    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        ok: !timedOut && exitCode === 0,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: timedOut ? "Command timed out." : Buffer.concat(stderrChunks).toString("utf8").trim(),
        exitCode
      });
    });
  });
}

async function artifactSummary(label: string, filePath: string): Promise<StatusArtifactSummary> {
  const exists = await fileExists(filePath);
  if (!exists) {
    return {
      label,
      path: filePath,
      exists
    };
  }

  const stat = await fs.stat(filePath);
  return {
    label,
    path: filePath,
    exists,
    updatedAt: stat.mtime.toISOString()
  };
}

function renderArtifacts(artifacts: StatusArtifactSummary[]): string {
  return artifacts
    .map((artifact) => {
      const time = artifact.updatedAt ? ` | updated=${artifact.updatedAt}` : "";
      return `- ${artifact.label}: ${artifact.exists ? "present" : "missing"} | ${artifact.path}${time}`;
    })
    .join("\n");
}

function renderSuggestions(suggestions: SuggestedAction[]): string {
  return suggestions.length > 0
    ? suggestions
        .map(
          (suggestion) => `### ${suggestion.label}

- Priority: ${suggestion.priority.toUpperCase()}
- Command: \`${suggestion.command}\`
- Rationale: ${suggestion.rationale}`
        )
        .join("\n\n")
    : "No immediate follow-up actions suggested.";
}

function doctorStatusFromSummary(doctorSummary: { failed?: number; warnings?: number } | undefined): DoctorCheckStatus | "unknown" {
  if (!doctorSummary) {
    return "unknown";
  }

  if ((doctorSummary.failed ?? 0) > 0) {
    return "fail";
  }

  if ((doctorSummary.warnings ?? 0) > 0) {
    return "warn";
  }

  return "pass";
}

function buildHeadline(summary: StatusResult["summary"]): string {
  const parts = [
    `doctor=${summary.doctorStatus}`,
    `swarm=${summary.swarmStatus}`,
    `plan=${summary.planStatus}`,
    `artifacts=${summary.artifactCount}`
  ];

  return `Status snapshot: ${parts.join(", ")}`;
}

function renderMemoryReadiness(result: StatusResult["memoryReadiness"]): string {
  return `- Status: ${result.status}
- Reason: ${result.reason}
- Facts: ${result.factsCount}
- Evidence refs: ${result.evidenceCount}
- Token guidance items: ${result.tokenGuidanceCount}
- Generated: ${result.generatedAt ?? "unknown"}
- Age hours: ${result.ageHours ?? "unknown"}
- Max age hours: ${result.maxAgeHours}
- Markdown: ${result.memoryBriefPath}
- JSON: ${result.memoryBriefJsonPath}`;
}

function renderStatusReport(
  context: ProjectContext,
  result: StatusResult
): string {
  return `# Status

## Summary

- Repository: ${context.repoName}
- Target: ${context.targetPath}
- Output: ${context.outputPath}
- Git repo: ${result.git.isGitRepo ? "yes" : "no"}
- Branch: ${result.git.branch ?? "unknown"}
- Headline: ${result.summary.headline}

## Artifacts

${renderArtifacts(result.artifacts)}

## Memory Readiness

${renderMemoryReadiness(result.memoryReadiness)}

## Suggested Actions

${renderSuggestions(result.suggestions)}
`;
}

export async function buildStatus(
  context: ProjectContext,
  deps: StatusDeps = {}
): Promise<StatusResult> {
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const doctorMemoryPath = path.join(context.memoryDir, "doctor", "doctor.json");
  const workflows = buildWorkflowRuntimeDefinitions(context);
  const artifacts = (
    await Promise.all(
      workflows.flatMap((workflow) =>
        workflow.artifactPaths.map((artifactPath, index) =>
          artifactSummary(workflow.artifactLabels[index] ?? workflow.artifactLabels[0] ?? workflow.humanLabel, artifactPath)
        )
      )
    )
  ).filter((artifact, index, all) => all.findIndex((candidate) => candidate.label === artifact.label && candidate.path === artifact.path) === index);

  const doctorMemory = await readJsonSafe<{ summary?: { failed?: number; warnings?: number } }>(doctorMemoryPath);
  const doctorStatus = doctorStatusFromSummary(doctorMemory?.summary);
  const memoryReadiness = await assessMemoryReadiness(context);

  const gitRepo = await runCommand("git", ["-C", context.targetPath, "rev-parse", "--is-inside-work-tree"], { timeoutMs: 5_000 });
  const branch = gitRepo.ok
    ? await runCommand("git", ["-C", context.targetPath, "branch", "--show-current"], { timeoutMs: 5_000 })
    : undefined;

  const summary: StatusResult["summary"] = {
    headline: "",
    artifactCount: artifacts.filter((artifact) => artifact.exists).length,
    doctorStatus,
    swarmStatus: artifacts.find((artifact) => artifact.label === "Swarm")?.exists ? "available" : "missing",
    planStatus: artifacts.find((artifact) => artifact.label === "Improvement Plan")?.exists ? "available" : "missing"
  };
  summary.headline = buildHeadline(summary);
  const suggestions = deriveStatusSuggestions({
    context,
    summary,
    artifacts
  });

  const reportPath = path.join(context.reportsDir, "status.md");
  const memoryPath = path.join(context.memoryDir, "status", "status.json");
  await writeFileEnsured(reportPath, renderStatusReport(context, {
    context,
    reportPath,
    memoryPath,
    git: {
      isGitRepo: gitRepo.ok,
      branch: branch?.stdout || undefined
    },
    summary,
    memoryReadiness,
    artifacts,
    suggestions
  }));
  await writeJsonEnsured(memoryPath, {
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    git: {
      isGitRepo: gitRepo.ok,
      branch: branch?.stdout || undefined
    },
    summary,
    memoryReadiness,
    artifacts,
    suggestions
  });

  return {
    context,
    reportPath,
    memoryPath,
    git: {
      isGitRepo: gitRepo.ok,
      branch: branch?.stdout || undefined
    },
    summary,
    memoryReadiness,
    artifacts,
    suggestions
  };
}
