import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import type { ModelInventory } from "../ai_router/router";
import { deriveDoctorSuggestions } from "../reaction_engine";
import { ensureDir, fileExists, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { DoctorCheck, DoctorCheckStatus, DoctorResult, ProjectContext, SuggestedAction } from "../../shared/types";

interface DoctorAssistant {
  listModels?: () => Promise<ModelInventory>;
}

interface CommandProbeResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

interface DoctorDeps {
  runCommand?: (command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }) => Promise<CommandProbeResult>;
  projectRoot?: string;
}

function statusRank(status: DoctorCheckStatus): number {
  if (status === "fail") {
    return 3;
  }
  if (status === "warn") {
    return 2;
  }
  return 1;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
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

function withDefaultTag(model: string): string {
  return model.includes(":") ? model : `${model}:latest`;
}

function matchesModel(candidate: string, available: string[]): boolean {
  const normalized = withDefaultTag(candidate);
  return available.some((model) => model === candidate || model === normalized || model.startsWith(`${candidate}:`));
}

function buildCheck(id: string, label: string, status: DoctorCheckStatus, summary: string, details: string[] = []): DoctorCheck {
  return { id, label, status, summary, details };
}

function countByStatus(checks: DoctorCheck[], status: DoctorCheckStatus): number {
  return checks.filter((check) => check.status === status).length;
}

function buildHeadline(checks: DoctorCheck[]): string {
  const failed = countByStatus(checks, "fail");
  const warnings = countByStatus(checks, "warn");

  if (failed > 0) {
    return `Doctor found ${failed} failing checks and ${warnings} warnings.`;
  }

  if (warnings > 0) {
    return `Doctor found ${warnings} warnings and no failing checks.`;
  }

  return "Doctor found no failing checks.";
}

function resolveProjectBrainRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (parsed.name === "project-brain") {
          return current;
        }
      } catch {
        // Keep walking.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

async function defaultRunCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {}
): Promise<CommandProbeResult> {
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
        exitCode: null,
        stdout: "",
        stderr: error.message
      });
    });

    child.on("close", (exitCode) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        ok: !timedOut && exitCode === 0,
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString("utf8").trim(),
        stderr: timedOut ? "Command timed out." : Buffer.concat(stderrChunks).toString("utf8").trim()
      });
    });
  });
}

function buildDoctorReport(
  context: ProjectContext,
  summary: DoctorResult["summary"],
  checks: DoctorCheck[],
  suggestions: SuggestedAction[]
): string {
  return `# Doctor

## Summary

- Repository: ${context.repoName}
- Target: ${context.targetPath}
- Output: ${context.outputPath}
- Passed: ${summary.passed}
- Warnings: ${summary.warnings}
- Failed: ${summary.failed}
- Headline: ${summary.headline}

## Checks

${checks
  .map(
    (check) => `### ${check.label}

- Status: ${check.status.toUpperCase()}
- Summary: ${check.summary}

Details:
${renderList(check.details)}`
  )
  .join("\n\n")}

## Suggested Actions

${renderSuggestions(suggestions)}
`;
}

export async function runDoctor(
  context: ProjectContext,
  assistant: DoctorAssistant,
  deps: DoctorDeps = {}
): Promise<DoctorResult> {
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const projectRoot = deps.projectRoot ?? resolveProjectBrainRoot(__dirname);
  const checks: DoctorCheck[] = [];

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push(
    buildCheck(
      "node-runtime",
      "Node Runtime",
      nodeMajor >= 18 ? "pass" : "fail",
      `Node ${process.version} detected.`,
      nodeMajor >= 18 ? ["Global fetch and AbortSignal.timeout are available."] : ["project-brain expects Node 18+."]
    )
  );

  const gitBinary = await runCommand("git", ["--version"], { timeoutMs: 5_000 });
  checks.push(
    buildCheck(
      "git-binary",
      "Git Binary",
      gitBinary.ok ? "pass" : "fail",
      gitBinary.ok ? gitBinary.stdout || "Git is available." : "Git is not available in PATH.",
      gitBinary.ok ? [] : [gitBinary.stderr || "Install git and retry."]
    )
  );

  const gitRepo = await runCommand("git", ["-C", context.targetPath, "rev-parse", "--is-inside-work-tree"], { timeoutMs: 5_000 });
  if (!gitBinary.ok) {
    checks.push(buildCheck("git-repository", "Target Git Repository", "warn", "Skipped because git is unavailable.", []));
  } else {
    const branch = gitRepo.ok
      ? await runCommand("git", ["-C", context.targetPath, "branch", "--show-current"], { timeoutMs: 5_000 })
      : undefined;
    checks.push(
      buildCheck(
        "git-repository",
        "Target Git Repository",
        gitRepo.ok ? "pass" : "warn",
        gitRepo.ok ? "Target path is a git repository." : "Target path is not a git repository.",
        gitRepo.ok && branch?.stdout ? [`Branch: ${branch.stdout}`] : []
      )
    );
  }

  const ollamaBinary = await runCommand("ollama", ["--version"], { timeoutMs: 5_000 });
  checks.push(
    buildCheck(
      "ollama-binary",
      "Ollama Binary",
      ollamaBinary.ok ? "pass" : "warn",
      ollamaBinary.ok ? ollamaBinary.stdout || "Ollama is available." : "Ollama is not available in PATH.",
      ollamaBinary.ok ? [] : [ollamaBinary.stderr || "Install Ollama if you want local model execution."]
    )
  );

  let inventory: ModelInventory | undefined;
  if (assistant.listModels) {
    try {
      inventory = await assistant.listModels();
    } catch (error) {
      checks.push(
        buildCheck(
          "ollama-api",
          "Ollama API",
          "warn",
          "Could not query the Ollama API through the model router.",
          [error instanceof Error ? error.message : String(error)]
        )
      );
    }
  } else {
    checks.push(buildCheck("ollama-api", "Ollama API", "warn", "Model inventory is unavailable from the current AI router.", []));
  }

  if (inventory) {
    checks.push(
      buildCheck(
        "ollama-api",
        "Ollama API",
        inventory.availableModels.length > 0 ? "pass" : ollamaBinary.ok ? "warn" : "fail",
        inventory.availableModels.length > 0
          ? `Detected ${inventory.availableModels.length} Ollama model(s).`
          : "No Ollama models were detected.",
        inventory.availableModels.map((model) => `${model.name} (${model.residency}, offline=${model.offlineCapable ? "yes" : "no"})`)
      )
    );

    const availableNames = inventory.availableModels.map((model) => model.name);
    const profileChecks = Object.entries(inventory.resolvedProfiles).map(([profile, model]) => ({
      profile,
      model,
      available: matchesModel(model, availableNames)
    }));
    const missingCriticalProfiles = profileChecks.filter((entry) => ["worker", "reviewer", "reasoning"].includes(entry.profile) && !entry.available);
    const missingOptionalProfiles = profileChecks.filter((entry) => !["worker", "reviewer", "reasoning"].includes(entry.profile) && !entry.available);
    checks.push(
      buildCheck(
        "model-profiles",
        "Model Profiles",
        missingCriticalProfiles.length > 0 ? "fail" : missingOptionalProfiles.length > 0 ? "warn" : "pass",
        missingCriticalProfiles.length > 0
          ? "One or more critical local model profiles are unavailable."
          : missingOptionalProfiles.length > 0
            ? "Some non-critical model profiles are unavailable, but local fallbacks exist."
            : "All configured model profiles are available.",
        profileChecks.map((entry) => `${entry.profile}: ${entry.model} (${entry.available ? "available" : "missing"})`)
      )
    );

    checks.push(
      buildCheck(
        "swarm-local-readiness",
        "Swarm Local Readiness",
        inventory.offlineReady ? "pass" : "warn",
        inventory.offlineReady ? "Local-first swarm runs are supported." : "Offline/local swarm readiness is incomplete.",
        [
          `Offline mode: ${inventory.offlineMode ? "yes" : "no"}`,
          `Remote Ollama allowed: ${inventory.remoteOllamaAllowed ? "yes" : "no"}`,
          `Offline ready: ${inventory.offlineReady ? "yes" : "no"}`
        ]
      )
    );
  }

  const configPath = path.join(projectRoot, "config", "models.json");
  const configExists = await fileExists(configPath);
  checks.push(
    buildCheck(
      "model-config",
      "Model Config",
      configExists ? "pass" : "fail",
      configExists ? "Model config file is present." : "config/models.json is missing.",
      [configPath]
    )
  );

  const distCliPath = path.join(projectRoot, "dist", "cli", "project-brain.js");
  const distCliExists = await fileExists(distCliPath);
  checks.push(
    buildCheck(
      "cli-build",
      "CLI Build Artifact",
      distCliExists ? "pass" : "warn",
      distCliExists ? "Built CLI artifact is present." : "Built CLI artifact is missing.",
      [distCliPath]
    )
  );

  try {
    await ensureDir(context.outputPath);
    await ensureDir(context.reportsDir);
    await ensureDir(path.join(context.memoryDir, "doctor"));
    checks.push(
      buildCheck(
        "output-path",
        "Output Path",
        "pass",
        "Output directories are writable.",
        [context.outputPath, context.reportsDir, path.join(context.memoryDir, "doctor")]
      )
    );
  } catch (error) {
    checks.push(
      buildCheck(
        "output-path",
        "Output Path",
        "fail",
        "Could not create or access the output directories.",
        [error instanceof Error ? error.message : String(error)]
      )
    );
  }

  const orderedChecks = checks.sort((left, right) => {
    const rankDelta = statusRank(right.status) - statusRank(left.status);
    return rankDelta !== 0 ? rankDelta : left.label.localeCompare(right.label);
  });
  const summary = {
    passed: countByStatus(orderedChecks, "pass"),
    warnings: countByStatus(orderedChecks, "warn"),
    failed: countByStatus(orderedChecks, "fail"),
    headline: buildHeadline(orderedChecks)
  };
  const suggestions = deriveDoctorSuggestions({
    context,
    checks: orderedChecks,
    summary
  });

  const reportPath = path.join(context.reportsDir, "doctor.md");
  const memoryPath = path.join(context.memoryDir, "doctor", "doctor.json");
  await writeFileEnsured(reportPath, buildDoctorReport(context, summary, orderedChecks, suggestions));
  await writeJsonEnsured(memoryPath, {
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    projectRoot,
    summary,
    checks: orderedChecks,
    suggestions
  });

  return {
    context,
    reportPath,
    memoryPath,
    summary,
    checks: orderedChecks,
    suggestions
  };
}
