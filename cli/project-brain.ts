#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";

import { Command } from "commander";

import { AIRouter } from "../core/ai_router/router";
import { ProjectBrainOrchestrator } from "../core/orchestrator/main";
import { setLoggerOptions, StructuredLogger } from "../shared/logger";
import type {
  CodebaseMapResult,
  ContextTrustLevel,
  DoctorSetupItem,
  EcosystemAnalysisResult,
  EcosystemCodebaseMapResult,
  GovernanceTrigger,
  LearningOutcome,
  OrchestrationResult,
  ProjectSeedArchetype,
  ProjectSeedInput,
  ProjectSeedPriority,
  SwarmEngine
} from "../shared/types";
import { createDefaultTerminalSession, launchTerminalConsole } from "./terminal-console";

const program = new Command();
const orchestrator = new ProjectBrainOrchestrator();
const aiRouter = new AIRouter();
const logger = new StructuredLogger("cli");

function readPackageVersion(): string {
  const candidates = [
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(__dirname, "..", "..", "package.json")
  ];

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
        return parsed.version;
      }
    } catch {
      // Try the next layout: source runs from cli/, built runs from dist/cli/.
    }
  }

  return "0.0.0";
}

function commandName(): string {
  const invokedName = path.basename(process.argv[1] ?? "project-brain").replace(/\.(?:cjs|js|mjs)$/i, "");
  return invokedName === "project-brain" || invokedName === "brain" ? invokedName : "project-brain";
}

function parseTimeoutMs(value: string): number {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid Ollama timeout: ${value}. Expected a positive integer in milliseconds.`);
  }

  return Math.trunc(timeoutMs);
}

function parsePositiveInteger(value: string, label: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid ${label}: ${value}. Expected a positive integer.`);
  }

  return Math.trunc(numeric);
}

function parseSwarmEngine(value: string): SwarmEngine {
  const normalized = value.trim().toLowerCase();
  if (normalized === "bounded" || normalized === "deepagents") {
    return normalized;
  }

  throw new Error(`Invalid swarm engine: ${value}. Expected bounded or deepagents.`);
}

type SwarmPreset = "cheap" | "balanced" | "thorough";
type ProjectSeedOptions = {
  name?: string;
  problem?: string;
  audience?: string;
  type?: string;
  template?: string;
  stack?: string;
  features?: string;
  auth?: string;
  roles?: string;
  data?: string;
  integrations?: string;
  priority?: string;
  language?: string;
  notes?: string;
  force?: boolean;
  yes?: boolean;
};

const PROJECT_ARCHETYPE_CHOICES: Array<{ value: ProjectSeedArchetype; label: string }> = [
  { value: "saas-webapp", label: "SaaS / web app" },
  { value: "marketing-site", label: "Marketing site" },
  { value: "mobile-app", label: "Mobile app" },
  { value: "api-backend", label: "API / backend" },
  { value: "internal-tool", label: "Internal tool" },
  { value: "content-platform", label: "Content platform" },
  { value: "custom", label: "Custom" }
];

const PROJECT_PRIORITY_CHOICES: Array<{ value: ProjectSeedPriority; label: string }> = [
  { value: "mvp-fast", label: "MVP rapido" },
  { value: "solid-architecture", label: "Arquitectura solida" },
  { value: "low-cost", label: "Costo bajo" },
  { value: "security-first", label: "Seguridad alta" }
];

function parseSwarmPreset(value?: string): SwarmPreset | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "cheap" || normalized === "balanced" || normalized === "thorough") {
    return normalized;
  }

  throw new Error(`Invalid swarm preset: ${value}. Expected cheap, balanced, or thorough.`);
}

function parseCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProjectArchetype(value?: string): ProjectSeedArchetype | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  const match = PROJECT_ARCHETYPE_CHOICES.find((choice) => choice.value === normalized);
  if (!match) {
    throw new Error(`Invalid project type: ${value}. Expected one of ${PROJECT_ARCHETYPE_CHOICES.map((choice) => choice.value).join(", ")}.`);
  }
  return match.value;
}

function parseProjectPriority(value?: string): ProjectSeedPriority | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  const match = PROJECT_PRIORITY_CHOICES.find((choice) => choice.value === normalized);
  if (!match) {
    throw new Error(`Invalid project priority: ${value}. Expected one of ${PROJECT_PRIORITY_CHOICES.map((choice) => choice.value).join(", ")}.`);
  }
  return match.value;
}

function parseOptionalBoolean(value?: string): boolean | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "si", "s", "1"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}. Expected yes or no.`);
}

async function cliPromptLine(rl: Interface, label: string, defaultValue = ""): Promise<string> {
  const prompt = defaultValue.length > 0 ? `${label} [${defaultValue}]: ` : `${label}: `;
  const answer = (await rl.question(prompt)).trim();
  return answer.length > 0 ? answer : defaultValue;
}

async function cliPromptYesNo(rl: Interface, label: string, defaultValue: boolean): Promise<boolean> {
  while (true) {
    const answer = (await rl.question(`${label} [${defaultValue ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (answer.length === 0) {
      return defaultValue;
    }
    if (["y", "yes", "s", "si"].includes(answer)) {
      return true;
    }
    if (["n", "no"].includes(answer)) {
      return false;
    }
    console.log("Responde y/n.");
  }
}

async function cliPromptChoice<T extends string>(
  rl: Interface,
  label: string,
  options: Array<{ value: T; label: string }>,
  defaultValue: T
): Promise<T> {
  while (true) {
    console.log(label);
    options.forEach((option, index) => {
      const suffix = option.value === defaultValue ? " (default)" : "";
      console.log(`  ${index + 1}. ${option.label}${suffix}`);
    });
    const answer = (await rl.question("> ")).trim().toLowerCase();
    if (answer.length === 0) {
      return defaultValue;
    }
    const numeric = Number.parseInt(answer, 10);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= options.length) {
      return options[numeric - 1].value;
    }
    const direct = options.find((option) => option.value === answer);
    if (direct) {
      return direct.value;
    }
    console.log("Seleccion invalida.");
  }
}

async function collectProjectSeedInput(targetPath: string, options: ProjectSeedOptions): Promise<ProjectSeedInput> {
  const canPrompt = !options.yes && process.stdin.isTTY && process.stdout.isTTY;
  const inferredName = path.basename(targetPath);
  const providedArchetype = parseProjectArchetype(options.type ?? options.template);
  const providedPriority = parseProjectPriority(options.priority);
  const providedAuth = parseOptionalBoolean(options.auth);

  if (!canPrompt) {
    return {
      projectName: options.name ?? inferredName,
      problem: options.problem ?? "Pending problem statement.",
      audience: options.audience ?? "Pending audience definition.",
      archetype: providedArchetype ?? "custom",
      stackPreference: options.stack ?? "",
      features: parseCsv(options.features),
      authRequired: providedAuth ?? false,
      roles: parseCsv(options.roles),
      dataEntities: parseCsv(options.data),
      integrations: parseCsv(options.integrations),
      priority: providedPriority ?? "solid-architecture",
      language: options.language ?? "es",
      notes: parseCsv(options.notes),
      contextOnly: true,
      overwrite: Boolean(options.force)
    };
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const projectName = options.name ?? (await cliPromptLine(rl, "Nombre del proyecto", inferredName));
    const problem = options.problem ?? (await cliPromptLine(rl, "Que problema resuelve"));
    const audience = options.audience ?? (await cliPromptLine(rl, "Para quien es"));
    const archetype = providedArchetype ?? (await cliPromptChoice(rl, "Tipo de proyecto", PROJECT_ARCHETYPE_CHOICES, "saas-webapp"));
    const stackPreference = options.stack ?? (await cliPromptLine(rl, "Stack preferido (opcional)", "recomiendame uno"));
    const features = options.features
      ? parseCsv(options.features)
      : parseCsv(await cliPromptLine(rl, "Features iniciales (CSV)", "onboarding,dashboard,admin settings"));
    const authRequired = providedAuth ?? (await cliPromptYesNo(rl, "Necesita autenticacion", true));
    const roles = options.roles
      ? parseCsv(options.roles)
      : authRequired
        ? parseCsv(await cliPromptLine(rl, "Roles (CSV)", "owner,admin,member"))
        : [];
    const dataEntities = options.data
      ? parseCsv(options.data)
      : parseCsv(await cliPromptLine(rl, "Entidades principales (CSV)", "User,Project,ActivityLog"));
    const integrations = options.integrations
      ? parseCsv(options.integrations)
      : parseCsv(await cliPromptLine(rl, "Integraciones (CSV)", "email,storage,analytics"));
    const priority = providedPriority ?? (await cliPromptChoice(rl, "Prioridad", PROJECT_PRIORITY_CHOICES, "solid-architecture"));
    const language = options.language ?? (await cliPromptLine(rl, "Idioma", "es"));
    const notes = options.notes ? parseCsv(options.notes) : parseCsv(await cliPromptLine(rl, "Notas adicionales (CSV)"));

    return {
      projectName,
      problem,
      audience,
      archetype,
      stackPreference,
      features,
      authRequired,
      roles,
      dataEntities,
      integrations,
      priority,
      language,
      notes,
      contextOnly: true,
      overwrite: Boolean(options.force)
    };
  } finally {
    rl.close();
  }
}

function swarmPresetOptions(preset?: SwarmPreset): {
  parallelism?: number;
  chunkSize?: number;
  taskTimeoutMs?: number;
  plannerTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  runTimeoutMs?: number;
  maxQueuedTasks?: number;
  maxRetries?: number;
} {
  switch (preset) {
    case "cheap":
      return {
        parallelism: 2,
        chunkSize: 1,
        taskTimeoutMs: 90_000,
        plannerTimeoutMs: 60_000,
        synthesisTimeoutMs: 60_000,
        runTimeoutMs: 120_000,
        maxQueuedTasks: 4,
        maxRetries: 0
      };
    case "balanced":
      return {
        chunkSize: 1,
        taskTimeoutMs: 120_000,
        plannerTimeoutMs: 80_000,
        synthesisTimeoutMs: 90_000,
        runTimeoutMs: 180_000,
        maxQueuedTasks: 6,
        maxRetries: 1
      };
    case "thorough":
      return {
        parallelism: 4,
        chunkSize: 2,
        taskTimeoutMs: 180_000,
        plannerTimeoutMs: 120_000,
        synthesisTimeoutMs: 120_000,
        runTimeoutMs: 360_000,
        maxQueuedTasks: 12,
        maxRetries: 1
      };
    default:
      return {};
  }
}

function printSuggestions(
  suggestions: Array<{
    label: string;
    command: string;
    rationale: string;
    priority: string;
  }>
): void {
  if (suggestions.length === 0) {
    return;
  }

  console.log("Suggested actions:");
  for (const suggestion of suggestions) {
    console.log(`- [${suggestion.priority.toUpperCase()}] ${suggestion.label}`);
    console.log(`  Command: ${suggestion.command}`);
    console.log(`  Why: ${suggestion.rationale}`);
  }
}

function printDoctorSetup(setupItems: DoctorSetupItem[]): void {
  if (setupItems.length === 0) {
    return;
  }

  const groups: Array<{ title: string; items: DoctorSetupItem[] }> = [
    { title: "Required local runtime", items: setupItems.filter((item) => item.tier === "required") },
    { title: "Recommended for this target", items: setupItems.filter((item) => item.tier === "recommended") },
    { title: "Optional open-source expansion", items: setupItems.filter((item) => item.tier === "optional") }
  ];

  console.log("Runtime setup:");
  for (const group of groups) {
    if (group.items.length === 0) {
      continue;
    }
    console.log(`- ${group.title}:`);
    for (const item of group.items) {
      console.log(`  - ${item.label}: ${item.status.toUpperCase()} - ${item.summary}`);
      console.log(`    Install / enable: ${item.installHint}`);
    }
  }
}

function resolveTarget(target: string): string {
  return path.resolve(process.cwd(), target);
}

const DEFAULT_OUTPUT_DIR_NAME = "BRAIN";

function resolveOutput(targetPath: string, output?: string): string {
  return output ? resolveTarget(output) : path.join(targetPath, DEFAULT_OUTPUT_DIR_NAME);
}

function resolveTrigger(trigger?: string): GovernanceTrigger {
  const aliases: Record<string, GovernanceTrigger> = {
    manual: "manual",
    "repository-change": "repository-change",
    "weekly-review": "weekly-review",
    "security-audit": "security-audit",
    "security-advisory": "security-advisory",
    "architecture-review": "architecture-review",
    "incident-detection": "incident-detection",
    "dependency-update": "dependency-update"
  };

  if (trigger && aliases[trigger]) {
    return aliases[trigger];
  }

  return "manual";
}

function resolveTrustLevel(trust?: string): ContextTrustLevel | undefined {
  if (!trust) {
    return undefined;
  }

  const normalized = trust.trim().toLowerCase();
  if (normalized === "official" || normalized === "maintainer" || normalized === "community") {
    return normalized;
  }

  throw new Error(`Invalid trust level: ${trust}. Expected official, maintainer, or community.`);
}

function isEcosystemResult(
  result: OrchestrationResult | EcosystemAnalysisResult
): result is EcosystemAnalysisResult {
  return "repositories" in result && "knowledgeGraphPath" in result;
}

function isEcosystemCodebaseMapResult(
  result: CodebaseMapResult | EcosystemCodebaseMapResult
): result is EcosystemCodebaseMapResult {
  return "repositories" in result && "rootPath" in result && !("context" in result);
}

program
  .name(commandName())
  .description("Analyze repositories, build project context, run specialist agents, and generate reports.")
  .version(readPackageVersion());

program
  .command("console")
  .alias("terminal")
  .option("--target <path>", "Initial repository or workspace target", ".")
  .option("-o, --output <dir>", "Initial output directory")
  .option("--engine <engine>", "Initial swarm engine: bounded or deepagents")
  .option("--parallel <n>", "Initial max parallel workers for swarm")
  .option("--chunk-size <n>", "Initial swarm chunk size")
  .option("--task-timeout-ms <ms>", "Initial per-worker timeout budget in milliseconds")
  .option("--planner-timeout-ms <ms>", "Initial planner timeout budget in milliseconds")
  .option("--synthesis-timeout-ms <ms>", "Initial synthesis timeout budget in milliseconds")
  .option("--run-timeout-ms <ms>", "Initial global timeout budget in milliseconds")
  .option("--max-queued-tasks <n>", "Initial cap for queued worker tasks")
  .option("--max-retries <n>", "Initial max retry count for worker chunks")
  .option("-t, --trigger <trigger>", "Default governance trigger", "manual")
  .option("--ollama-timeout <ms>", "Default Ollama inference timeout in milliseconds for console runs")
  .option("--verbose", "Enable verbose runtime logs for supported console actions")
  .description("Launch an interactive terminal console for configuring and running project-brain workflows.")
  .action(
    async (options: {
      target?: string;
      output?: string;
      engine?: string;
      parallel?: string;
      chunkSize?: string;
      taskTimeoutMs?: string;
      plannerTimeoutMs?: string;
      synthesisTimeoutMs?: string;
      runTimeoutMs?: string;
      maxQueuedTasks?: string;
      maxRetries?: string;
      trigger?: string;
      ollamaTimeout?: string;
      verbose?: boolean;
    }) => {
      const targetPath = resolveTarget(options.target ?? ".");
      const outputPath = resolveOutput(targetPath, options.output);
      const session = createDefaultTerminalSession(process.cwd());
      session.targetPath = targetPath;
      session.outputPath = outputPath;
      session.trigger = resolveTrigger(options.trigger);
      session.verbose = Boolean(options.verbose);
      session.swarmEngine = options.engine ? parseSwarmEngine(options.engine) : session.swarmEngine;
      session.parallelism = options.parallel
        ? parsePositiveInteger(options.parallel, "parallel worker count")
        : session.parallelism;
      session.chunkSize = options.chunkSize ? parsePositiveInteger(options.chunkSize, "chunk size") : session.chunkSize;
      session.taskTimeoutMs = options.taskTimeoutMs
        ? parsePositiveInteger(options.taskTimeoutMs, "task timeout")
        : session.taskTimeoutMs;
      session.plannerTimeoutMs = options.plannerTimeoutMs
        ? parsePositiveInteger(options.plannerTimeoutMs, "planner timeout")
        : session.plannerTimeoutMs;
      session.synthesisTimeoutMs = options.synthesisTimeoutMs
        ? parsePositiveInteger(options.synthesisTimeoutMs, "synthesis timeout")
        : session.synthesisTimeoutMs;
      session.runTimeoutMs = options.runTimeoutMs
        ? parsePositiveInteger(options.runTimeoutMs, "run timeout")
        : session.runTimeoutMs;
      session.maxQueuedTasks = options.maxQueuedTasks
        ? parsePositiveInteger(options.maxQueuedTasks, "max queued tasks")
        : session.maxQueuedTasks;
      session.maxRetries = options.maxRetries ? parsePositiveInteger(options.maxRetries, "max retries") : session.maxRetries;
      session.ollamaTimeoutMs = options.ollamaTimeout
        ? parsePositiveInteger(options.ollamaTimeout, "ollama timeout")
        : session.ollamaTimeoutMs;

      await launchTerminalConsole({
        orchestrator,
        aiRouter,
        initialSession: session
      });
    }
  );

program
  .command("models")
  .description("Show available local models and configured cloud model routing.")
  .action(async () => {
    const inventory = await aiRouter.listModels();
    console.log("Ollama models available:");
    if (inventory.availableModels.length === 0) {
      console.log("- None detected via Ollama");
    } else {
      for (const model of inventory.availableModels) {
        console.log(`- ${model.name} (${model.residency}, offline=${model.offlineCapable ? "yes" : "no"})`);
      }
    }
    console.log(`Configured local model: ${inventory.config.localModel}`);
    console.log(`Configured fallback model: ${inventory.config.fallbackModel}`);
    console.log(`Configured reasoning model: ${inventory.config.reasoningModel}`);
    console.log("Model profiles:");
    console.log(`- worker: ${inventory.resolvedProfiles.worker}`);
    console.log(`- reviewer: ${inventory.resolvedProfiles.reviewer}`);
    console.log(`- reasoning: ${inventory.resolvedProfiles.reasoning}`);
    console.log(`- planner: ${inventory.resolvedProfiles.planner}`);
    console.log(`- synthesizer: ${inventory.resolvedProfiles.synthesizer}`);
    console.log("Cloud model configured:");
    console.log(`- provider: ${inventory.cloudConfigured.provider}`);
    console.log(`- model: ${inventory.cloudConfigured.model}`);
    console.log("Routing rules:");
    for (const [task, route] of Object.entries(inventory.routing)) {
      console.log(`- ${task}: ${route}`);
    }
    console.log("Task profiles:");
    for (const [task, profile] of Object.entries(inventory.taskProfiles)) {
      console.log(`- ${task}: ${profile}`);
    }
    console.log(`Offline mode: ${inventory.offlineMode ? "yes" : "no"}`);
    console.log(`Remote Ollama allowed: ${inventory.remoteOllamaAllowed ? "yes" : "no"}`);
    console.log(`Offline ready: ${inventory.offlineReady ? "yes" : "no"}`);
  });

program
  .command("doctor")
  .argument("[target]", "Repository target to validate", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Run install, environment, model, and swarm readiness checks.")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.doctor(targetPath, outputPath);
    console.log(`Doctor report: ${result.reportPath}`);
    console.log(`Doctor memory: ${result.memoryPath}`);
    console.log(
      `Summary: passed=${result.summary.passed}, warnings=${result.summary.warnings}, failed=${result.summary.failed}`
    );
    console.log(`Headline: ${result.summary.headline}`);
    for (const check of result.checks) {
      console.log(`- ${check.label}: ${check.status.toUpperCase()} - ${check.summary}`);
    }
    printDoctorSetup(result.setupItems);
    printSuggestions(result.suggestions);
  });

program
  .command("security-audit")
  .argument("[target]", "Repository or workspace target to audit", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("-t, --trigger <trigger>", "Governance trigger", "security-audit")
  .option("--verbose", "Print structured runtime logs")
  .description("Run a structured multi-agent security audit with verified context and evidence-based findings.")
  .action(async (target: string, options: { output?: string; trigger?: string; verbose?: boolean }) => {
    setLoggerOptions({ verbose: Boolean(options.verbose) });
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.securityAudit(targetPath, outputPath, resolveTrigger(options.trigger));
    const counts = result.findings.reduce<Record<string, number>>((accumulator, finding) => {
      accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
      return accumulator;
    }, {});

    console.log(`Security audit report: ${result.reportPath}`);
    console.log(`Security audit memory: ${result.memoryPath}`);
    if (result.contextLiteReportPath) {
      console.log(`Context-lite report: ${result.contextLiteReportPath}`);
    }
    console.log(`Headline: ${result.headline}`);
    console.log(`Verdict: ${result.verdict}`);
    console.log(
      `Findings: critical=${counts.critical ?? 0}, high=${counts.high ?? 0}, medium=${counts.medium ?? 0}, low=${counts.low ?? 0}, info=${counts.info ?? 0}`
    );
    console.log(`Coverage gaps: ${result.coverage.filter((entry) => entry.status === "not-reviewed").length}`);
  });

program
  .command("status")
  .argument("[target]", "Repository target to summarize", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Show repository operational status, recent artifacts, and health signals.")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.status(targetPath, outputPath);
    const present = result.artifacts.filter((artifact) => artifact.exists).map((artifact) => artifact.label);
    const missing = result.artifacts.filter((artifact) => !artifact.exists).map((artifact) => artifact.label);
    console.log(`Status report: ${result.reportPath}`);
    console.log(`Status memory: ${result.memoryPath}`);
    console.log(`Git: repo=${result.git.isGitRepo ? "yes" : "no"}, branch=${result.git.branch ?? "unknown"}`);
    console.log(`Headline: ${result.summary.headline}`);
    console.log(`Memory: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
    console.log(`Ready: ${present.join(", ") || "None"}`);
    console.log(`Missing: ${missing.slice(0, 6).join(", ") || "None"}${missing.length > 6 ? ", plus more" : ""}`);
    printSuggestions(result.suggestions);
  });

program
  .command("resume")
  .argument("[target]", "Repository target to resume from", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Recover the latest useful project-brain checkpoint and suggest the next step.")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.resume(targetPath, outputPath);
    console.log(`Resume report: ${result.reportPath}`);
    console.log(`Resume memory: ${result.memoryPath}`);
    console.log(`Executive summary: ${result.executiveSummary.reportPath}`);
    console.log(`Git: repo=${result.git.isGitRepo ? "yes" : "no"}, branch=${result.git.branch ?? "unknown"}`);
    console.log(`Stage: ${result.summary.stage}`);
    console.log(`Headline: ${result.summary.headline}`);
    console.log(`Memory: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
    if (result.latestArtifact) {
      console.log(
        `Latest artifact: ${result.latestArtifact.label}${result.latestArtifact.updatedAt ? ` (${result.latestArtifact.updatedAt})` : ""}`
      );
    }
    for (const note of result.notes) {
      console.log(`- ${note}`);
    }
    printSuggestions(result.suggestions);
  });

program
  .command("start")
  .alias("go")
  .argument("[intent]", "Plain-language goal", "optimize analysis and cost")
  .argument("[target]", "Repository target", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--with-swarm", "Also run the model-heavy bounded swarm after cheap preflight")
  .description("Run the simple guided path: cheap memory, facts, runbook, harness audit, firewall, then suggest next step.")
  .action(async (intent: string, target: string, options: { output?: string; withSwarm?: boolean }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.start(targetPath, outputPath, intent, {
      withSwarm: Boolean(options.withSwarm)
    });
    console.log(`Start report: ${result.reportPath}`);
    console.log(`Start memory: ${result.memoryPath}`);
    console.log(`Executive summary: ${result.executiveSummary.reportPath}`);
    console.log(`Headline: ${result.headline}`);
    console.log(`Memory: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
    for (const step of result.executedSteps) {
      console.log(`- [${step.status}] ${step.label}: ${step.summary}`);
    }
    if (result.nextCommand) {
      console.log(`Next: ${result.nextCommand}`);
    }
  });

program
  .command("new")
  .alias("scaffold-context")
  .argument("<target>", "Directory for the new project context")
  .option("--name <name>", "Project name")
  .option("--problem <text>", "Problem the project solves")
  .option("--audience <text>", "Target audience")
  .option("--type <type>", "Project archetype")
  .option("--template <type>", "Alias for --type")
  .option("--stack <text>", "Preferred stack or 'recomiendame uno'")
  .option("--features <csv>", "Initial feature list")
  .option("--auth <yes|no>", "Whether authentication is required")
  .option("--roles <csv>", "Expected roles")
  .option("--data <csv>", "Primary data entities")
  .option("--integrations <csv>", "External integrations")
  .option("--priority <priority>", "mvp-fast, solid-architecture, low-cost, or security-first")
  .option("--language <code>", "Project language", "es")
  .option("--notes <csv>", "Additional notes")
  .option("--force", "Overwrite existing generated project seed artifacts")
  .option("--yes", "Use provided values and defaults without interactive questions")
  .description("Create a new project context with guided AI_CONTEXT, architecture, memory, and initial backlog artifacts.")
  .action(async (target: string, options: ProjectSeedOptions) => {
    const targetPath = resolveTarget(target);
    const input = await collectProjectSeedInput(targetPath, options);
    const result = await orchestrator.scaffoldProject(targetPath, input);

    console.log(`Project seed: ${result.projectName}`);
    console.log(`Target: ${result.targetPath}`);
    console.log(`Archetype: ${result.archetype}`);
    console.log(`Context only: ${result.contextOnly ? "yes" : "no"}`);
    console.log(`Charter: ${result.artifactPaths.projectCharterPath}`);
    console.log(`Requirements: ${result.artifactPaths.requirementsPath}`);
    console.log(`Blueprint: ${result.artifactPaths.blueprintPath}`);
    console.log(`Memory brief: ${result.artifactPaths.memoryBriefPath}`);
    console.log(`Backlog: ${result.artifactPaths.backlogPath}`);
    console.log(`CLAUDE: ${result.artifactPaths.claudePath}`);
    console.log(`Next: ${result.nextSteps.join(" | ")}`);
  });

program
  .command("init")
  .argument("[target]", "Repository to initialize", ".")
  .option("-o, --output <dir>", "Output directory")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const context = await orchestrator.initTarget(targetPath, outputPath);
    console.log(`Initialized project memory for ${context.repoName} at ${context.memoryDir}`);
  });

program
  .command("map-codebase")
  .alias("map")
  .argument("[target]", "Repository or workspace to map", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--verbose", "Print structured runtime logs")
  .action(async (target: string, options: { output?: string; verbose?: boolean }) => {
    setLoggerOptions({ verbose: Boolean(options.verbose) });
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    logger.info("CLI map-codebase invoked", {
      component: "cli",
      action: "command_start",
      command: "map-codebase",
      targetPath,
      outputPath
    });

    const result = await orchestrator.mapScope(targetPath, outputPath);

    if (isEcosystemCodebaseMapResult(result)) {
      logger.info("CLI map-codebase completed", {
        component: "cli",
        action: "command_complete",
        command: "map-codebase",
        repositories: result.repositories.map((repository) => repository.repoName)
      });
      console.log(`Mapped workspace at ${result.rootPath}`);
      console.log(`Repositories: ${result.repositories.map((repository) => repository.repoName).join(", ")}`);
      console.log(`Summary: ${result.summaryPath}`);
      return;
    }

    logger.info("CLI map-codebase completed", {
      component: "cli",
      action: "command_complete",
      command: "map-codebase",
      repoName: result.context.repoName,
      codebaseMapDir: result.codebaseMapDir
    });
    console.log(`Mapped ${result.context.repoName}`);
    console.log(`Codebase map: ${result.codebaseMapDir}`);
    console.log(`Summary: ${result.summaryPath}`);
    console.log(`Documents: ${result.files.map((filePath) => path.basename(filePath)).join(", ")}`);
  });

program
  .command("context-lite")
  .argument("[target]", "Repository target to materialize lightweight AI context for", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Generate a compact AI_CONTEXT pack for smaller apps without running the full project-brain pipeline.")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.contextLite(targetPath, outputPath);
    console.log(`Context-lite report: ${result.reportPath}`);
    console.log(`AI_CONTEXT: ${result.context.memoryDir}`);
    console.log(`Artifacts: ${result.artifactPaths.map((artifactPath) => path.basename(artifactPath)).join(", ")}`);
    console.log("Summary:");
    for (const line of result.summary) {
      console.log(`- ${line}`);
    }
    console.log("Requires confirmation:");
    for (const item of result.openQuestions) {
      console.log(`- ${item}`);
    }
  });

program
  .command("fact-query")
  .alias("fq")
  .argument("<query>", "Query over MEMORY_BRIEF and repository_fact_graph")
  .argument("[target]", "Repository target", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Query compact factual memory without calling an AI model.")
  .action(async (query: string, target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.factQuery(targetPath, outputPath, query);
    console.log(`Fact query report: ${result.reportPath}`);
    console.log(`Fact query memory: ${result.memoryPath}`);
    console.log(`Answer: ${result.answer}`);
    console.log(`Memory matches: ${result.memoryMatches.length}`);
    console.log(`Node matches: ${result.nodeMatches.length}`);
    console.log(`Edge matches: ${result.edgeMatches.length}`);
    console.log(`Evidence refs: ${result.evidenceRefs.join(", ") || "None"}`);
    if (result.unknowns.length > 0) {
      console.log(`Unknowns: ${result.unknowns.join(" | ")}`);
    }
  });

program
  .command("harness-audit")
  .alias("ha")
  .argument("[target]", "Repository target", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Audit progressive memory, cost gates, and continuity before model-heavy analysis.")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.harnessAudit(targetPath, outputPath);
    console.log(`Harness audit report: ${result.reportPath}`);
    console.log(`Harness audit memory: ${result.memoryPath}`);
    console.log(`Score: ${result.score}`);
    console.log(`Token risk: ${result.tokenRisk}`);
    console.log(`Memory: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
    for (const item of result.checks) {
      console.log(`- [${item.status}] ${item.label}: ${item.summary}`);
    }
    if (result.suggestedCommands.length > 0) {
      console.log("Suggested commands:");
      for (const command of result.suggestedCommands) {
        console.log(`- ${command}`);
      }
    }
  });

program
  .command("runbook")
  .argument("<intent>", "Goal to organize into a token-aware project-brain runbook")
  .argument("[target]", "Repository target", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Create a deterministic, token-aware runbook before expensive model analysis.")
  .action(async (intent: string, target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.runbook(targetPath, outputPath, intent);
    console.log(`Runbook report: ${result.reportPath}`);
    console.log(`Runbook memory: ${result.memoryPath}`);
    console.log(`Executive summary: ${result.executiveSummary.reportPath}`);
    for (const item of result.steps) {
      console.log(`- [${item.status}] ${item.id}. ${item.title}: ${item.command}`);
    }
  });

program
  .command("analyze")
  .argument("<target>", "Repository to analyze")
  .option("-o, --output <dir>", "Output directory")
  .option("-t, --trigger <trigger>", "Governance trigger")
  .option("--ollama-timeout <ms>", "Override Ollama inference timeout in milliseconds")
  .option("--verbose", "Print structured runtime logs")
  .action(async (target: string, options: { output?: string; trigger?: string; ollamaTimeout?: string; verbose?: boolean }) => {
    setLoggerOptions({ verbose: Boolean(options.verbose) });
    if (options.ollamaTimeout) {
      process.env.OLLAMA_TIMEOUT_MS = String(parseTimeoutMs(options.ollamaTimeout));
    }
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    logger.info("CLI analyze invoked", {
      component: "cli",
      action: "command_start",
      command: "analyze",
      targetPath,
      outputPath,
      trigger: resolveTrigger(options.trigger),
      ollamaTimeoutMs: process.env.OLLAMA_TIMEOUT_MS ? Number(process.env.OLLAMA_TIMEOUT_MS) : undefined
    });
    const result = await orchestrator.analyzeScope(targetPath, outputPath, resolveTrigger(options.trigger));

    if (isEcosystemResult(result)) {
      logger.info("CLI analyze completed", {
        component: "cli",
        action: "command_complete",
        command: "analyze",
        repositories: result.repositories.map((repository) => repository.repoName)
      });
      console.log(`Analyzed ecosystem at ${result.rootPath}`);
      console.log(`Repositories: ${result.repositories.map((repository) => repository.repoName).join(", ")}`);
      console.log(`Knowledge graph: ${result.knowledgeGraphPath}`);
      console.log(`Ecosystem report: ${result.ecosystemReportPath}`);
      console.log(`Runtime observability: ${result.runtimeObservabilityPath}`);
      console.log(`Telemetry: ${result.telemetryPath}`);
      return;
    }

    logger.info("CLI analyze completed", {
      component: "cli",
      action: "command_complete",
      command: "analyze",
      repoName: result.context.repoName
    });
    console.log(`Analyzed ${result.context.repoName}`);
    console.log(`AI_CONTEXT: ${result.context.memoryDir}`);
    console.log(`Reports: ${result.context.reportsDir}`);
    if (result.reportQualityPath) {
      console.log(`Report quality: ${result.reportQualityPath}`);
    }
    console.log(`Docs: ${result.context.docsDir}`);
    console.log(`Tasks: ${result.context.taskBoardDir}`);
    console.log(`Learnings: ${result.context.learningDir}`);
    console.log(`Proposals: ${result.context.proposalDir}`);
  });

program
  .command("agents")
  .argument("<target>", "Repository to evaluate with specialist agents")
  .option("-o, --output <dir>", "Output directory")
  .option("-t, --trigger <trigger>", "Governance trigger")
  .option("--verbose", "Print structured runtime logs")
  .action(async (target: string, options: { output?: string; trigger?: string; verbose?: boolean }) => {
    setLoggerOptions({ verbose: Boolean(options.verbose) });
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const reports = await orchestrator.runAgents(targetPath, outputPath, resolveTrigger(options.trigger));
    console.log(`Ran ${reports.length} agents for ${targetPath}`);
  });

program
  .command("weekly")
  .argument("<target>", "Repository to generate weekly artifacts for")
  .option("-o, --output <dir>", "Output directory")
  .option("--verbose", "Print structured runtime logs")
  .action(async (target: string, options: { output?: string; verbose?: boolean }) => {
    setLoggerOptions({ verbose: Boolean(options.verbose) });
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    logger.info("CLI weekly invoked", {
      component: "cli",
      action: "command_start",
      command: "weekly",
      targetPath,
      outputPath
    });
    const result = await orchestrator.generateWeeklyScope(targetPath, outputPath);

    if (isEcosystemResult(result)) {
      logger.info("CLI weekly completed", {
        component: "cli",
        action: "command_complete",
        command: "weekly",
        repositories: result.repositories.map((repository) => repository.repoName)
      });
      console.log(`Weekly ecosystem reports generated for ${result.repositories.length} repositories`);
      console.log(`Ecosystem report: ${result.ecosystemReportPath}`);
      console.log(`Knowledge graph: ${result.knowledgeGraphPath}`);
      return;
    }

    logger.info("CLI weekly completed", {
      component: "cli",
      action: "command_complete",
      command: "weekly",
      repoName: result.context.repoName
    });
    console.log(`Weekly reports generated for ${result.context.repoName}`);
    console.log(`Weekly report: ${result.weeklyReportPath}`);
    console.log(`Risk report: ${result.riskReportPath}`);
    if (result.reportQualityPath) {
      console.log(`Report quality: ${result.reportQualityPath}`);
    }
  });

program
  .command("code-graph")
  .alias("graph")
  .argument("[target]", "Repository to index into code-graph-v2", ".")
  .option("-o, --output <dir>", "Output directory")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.buildCodeGraph(targetPath, outputPath);
    console.log(`Code graph: ${result.graphPath}`);
    if (result.factGraphPath) {
      console.log(`Repository fact graph: ${result.factGraphPath}`);
    }
    if (result.factReportPath) {
      console.log(`Repository fact report: ${result.factReportPath}`);
    }
    console.log(`Build mode: ${result.graph.build.mode}`);
    console.log(`Files: ${result.graph.stats.files}`);
    console.log(`Symbols: ${result.graph.stats.symbols}`);
    console.log(`Nodes: ${result.graph.stats.nodes}`);
    console.log(`Edges: ${result.graph.stats.edges}`);
    if (result.factGraph) {
      console.log(`Fact graph nodes: ${result.factGraph.stats.nodes}`);
      console.log(`Fact graph edges: ${result.factGraph.stats.edges}`);
    }
    console.log(`Updated files: ${result.graph.build.updatedFiles.join(", ") || "None"}`);
  });

program
  .command("impact-radius")
  .alias("impact")
  .argument("[target]", "Repository to analyze for blast radius", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--files <csv>", "Comma-separated repository-relative files to analyze")
  .option("--base <ref>", "Base git ref for changed files")
  .option("--head <ref>", "Head git ref for changed files")
  .action(async (
    target: string,
    options: { output?: string; files?: string; base?: string; head?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.analyzeImpact(targetPath, outputPath, {
      files: options.files?.split(",").map((filePath) => filePath.trim()).filter(Boolean),
      baseRef: options.base,
      headRef: options.head
    });
    console.log(`Impact report: ${result.reportPath}`);
    console.log(`Graph: ${result.graphPath}`);
    console.log(`Changed files: ${result.changedFiles.join(", ") || "None"}`);
    console.log(`Review set: ${result.reviewFiles.join(", ") || "None"}`);
  });

program
  .command("review-delta")
  .argument("[target]", "Repository to review from git diff", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--base <ref>", "Base git ref", "HEAD~1")
  .option("--head <ref>", "Head git ref", "HEAD")
  .action(async (
    target: string,
    options: { output?: string; base?: string; head?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.reviewDelta(targetPath, outputPath, {
      baseRef: options.base,
      headRef: options.head
    });
    console.log(`Impact report: ${result.reportPath}`);
    console.log(`Changed files: ${result.changedFiles.join(", ") || "None"}`);
    console.log(`Review set: ${result.reviewFiles.join(", ") || "None"}`);
    console.log(`Related tests: ${result.impactedTests.join(", ") || "None"}`);
  });

program
  .command("ask")
  .argument("<intent>", "Plain-language request such as \"identifica este proyecto\"")
  .argument("[target]", "Repository or workspace target", ".")
  .option("-o, --output <dir>", "Output directory")
  .action(async (
    intent: string,
    target: string,
    options: { output?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.ask(targetPath, outputPath, intent);
    console.log(`Workflow: ${result.workflow}`);
    console.log(`Brief: ${result.briefPath}`);
    console.log(`Headline: ${result.headline}`);
    console.log(`Reason: ${result.routingReason}`);
    console.log(`Artifacts: ${result.artifacts.map((artifact) => `${artifact.label}=${artifact.path}`).join(" | ") || "None"}`);
    if (result.guidedExecution) {
      console.log(`Guided: ${result.guidedExecution.label} -> ${result.guidedExecution.command}`);
    }
    if (result.aiAssistance) {
      console.log(
        `AI assist: ${result.aiAssistance.model} (${result.aiAssistance.provider}, ${result.aiAssistance.residency}, profile=${result.aiAssistance.profile})`
      );
    }
    console.log(`Next: ${result.followUps.join(" | ")}`);
  });

program
  .command("swarm")
  .argument("<intent>", "Delegated analysis request such as \"ayudame a mejorar este repo\"")
  .argument("[target]", "Repository target", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--engine <engine>", "Swarm engine: bounded or deepagents", "bounded")
  .option("--preset <preset>", "Execution preset: cheap, balanced, or thorough")
  .option("--parallel <n>", "Maximum parallel workers for the swarm")
  .option("--chunk-size <n>", "How many top-level areas each worker should inspect at once")
  .option("--task-timeout-ms <ms>", "Per-worker timeout budget in milliseconds")
  .option("--planner-timeout-ms <ms>", "Planner timeout budget in milliseconds")
  .option("--synthesis-timeout-ms <ms>", "Synthesis timeout budget in milliseconds")
  .option("--run-timeout-ms <ms>", "Global timeout budget for the whole swarm run")
  .option("--max-queued-tasks <n>", "Hard cap for how many chunked worker tasks can be queued")
  .option("--max-retries <n>", "How many retries to allow before a worker chunk is marked failed")
  .action(async (
    intent: string,
    target: string,
    options: {
      output?: string;
      engine?: string;
      preset?: string;
      parallel?: string;
      chunkSize?: string;
      taskTimeoutMs?: string;
      plannerTimeoutMs?: string;
      synthesisTimeoutMs?: string;
      runTimeoutMs?: string;
      maxQueuedTasks?: string;
      maxRetries?: string;
    }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const presetOptions = swarmPresetOptions(parseSwarmPreset(options.preset));
    const result = await orchestrator.swarm(targetPath, outputPath, intent, {
      engine: options.engine ? parseSwarmEngine(options.engine) : undefined,
      parallelism: options.parallel ? parsePositiveInteger(options.parallel, "parallel worker count") : presetOptions.parallelism,
      chunkSize: options.chunkSize ? parsePositiveInteger(options.chunkSize, "chunk size") : presetOptions.chunkSize,
      taskTimeoutMs: options.taskTimeoutMs ? parsePositiveInteger(options.taskTimeoutMs, "task timeout") : presetOptions.taskTimeoutMs,
      plannerTimeoutMs: options.plannerTimeoutMs ? parsePositiveInteger(options.plannerTimeoutMs, "planner timeout") : presetOptions.plannerTimeoutMs,
      synthesisTimeoutMs: options.synthesisTimeoutMs ? parsePositiveInteger(options.synthesisTimeoutMs, "synthesis timeout") : presetOptions.synthesisTimeoutMs,
      runTimeoutMs: options.runTimeoutMs ? parsePositiveInteger(options.runTimeoutMs, "run timeout") : presetOptions.runTimeoutMs,
      maxQueuedTasks: options.maxQueuedTasks ? parsePositiveInteger(options.maxQueuedTasks, "max queued tasks") : presetOptions.maxQueuedTasks,
      maxRetries: options.maxRetries ? parsePositiveInteger(options.maxRetries, "max retries") : presetOptions.maxRetries
    });
    console.log(`Engine: ${result.engine}`);
    console.log(`Swarm report: ${result.reportPath}`);
    console.log(`Swarm memory: ${result.memoryPath}`);
    console.log(`Planner: ${result.planner.model} (${result.planner.provider}, ${result.planner.residency})`);
    console.log(
      `Chunking: size=${result.chunking.selectedChunkSize}, strategy=${result.chunking.queueStrategy}, scopeBias=${result.chunking.scopeBias}, scopeChunks=${result.chunking.scopeChunks}, queuedTasks=${result.chunking.queuedTasks}`
    );
    console.log(
      `Resilience: localBudgetMode=${result.resilience.localBudgetMode}, adaptiveQueueBudget=${result.resilience.adaptiveQueueBudget}, runTimeoutMs=${result.resilience.runTimeoutMs}, plannerTimeoutMs=${result.resilience.plannerTimeoutMs}, synthesisTimeoutMs=${result.resilience.synthesisTimeoutMs}, taskTimeoutMs=${result.resilience.taskTimeoutMs}, queueBudget=${result.resilience.queueBudget}, maxRetries=${result.resilience.maxRetries}, timedOut=${result.resilience.timedOutTasks}, retried=${result.resilience.retriedTasks}, failed=${result.resilience.failedTasks}, dropped=${result.resilience.droppedTasks}`
    );
    console.log(
      `Parallelism: ${result.parallelism.selected} workers (cpu=${result.parallelism.cpuCount}, load1m=${result.parallelism.loadAverage1m}, freeMemMb=${result.parallelism.freeMemoryMb}, pressure=${result.parallelism.pressure})`
    );
    console.log(`Tasks: ${result.tasks.map((task) => `${task.title}[${task.profile}]`).join(" | ") || "None"}`);
    console.log(`Synthesis: ${result.synthesis.headline}`);
  });

program
  .command("self-improve")
  .argument("[target]", "Repository target to improve with the bounded swarm", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--intent <text>", "Override the default self-improvement intent")
  .action(async (
    target: string,
    options: {
      output?: string;
      intent?: string;
    }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.selfImprove(targetPath, outputPath, options.intent);
    console.log(`Self-improve report: ${result.reportPath}`);
    console.log(`Swarm memory: ${result.memoryPath}`);
    console.log(`Planner: ${result.planner.model} (${result.planner.provider}, ${result.planner.residency})`);
    console.log(
      `Chunking: size=${result.chunking.selectedChunkSize}, strategy=${result.chunking.queueStrategy}, scopeChunks=${result.chunking.scopeChunks}, queuedTasks=${result.chunking.queuedTasks}`
    );
    console.log(`Scope bias: ${result.chunking.scopeBias}`);
    console.log(
      `Resilience: localBudgetMode=${result.resilience.localBudgetMode}, adaptiveQueueBudget=${result.resilience.adaptiveQueueBudget}, runTimeoutMs=${result.resilience.runTimeoutMs}, plannerTimeoutMs=${result.resilience.plannerTimeoutMs}, synthesisTimeoutMs=${result.resilience.synthesisTimeoutMs}, taskTimeoutMs=${result.resilience.taskTimeoutMs}, queueBudget=${result.resilience.queueBudget}, maxRetries=${result.resilience.maxRetries}, timedOut=${result.resilience.timedOutTasks}, retried=${result.resilience.retriedTasks}, failed=${result.resilience.failedTasks}, dropped=${result.resilience.droppedTasks}`
    );
    console.log(
      `Parallelism: ${result.parallelism.selected} workers (cpu=${result.parallelism.cpuCount}, load1m=${result.parallelism.loadAverage1m}, freeMemMb=${result.parallelism.freeMemoryMb}, pressure=${result.parallelism.pressure})`
    );
    console.log(`Tasks: ${result.tasks.map((task) => `${task.title}[${task.profile}]`).join(" | ") || "None"}`);
    console.log(`Synthesis: ${result.synthesis.headline}`);
  });

program
  .command("context-search")
  .argument("<query>", "Context query such as \"express observability\"")
  .argument("[target]", "Repository that owns the output context", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--trust <level>", "Trust filter: official, maintainer, or community")
  .action(async (
    query: string,
    target: string,
    options: { output?: string; trust?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.contextSearch(targetPath, outputPath, query, resolveTrustLevel(options.trust));
    console.log(`Context search report: ${result.reportPath}`);
    console.log(`Cache: ${result.cachePath}`);
    console.log(
      `Hits: ${result.hits.map((hit) => `${hit.entry.id}(${hit.entry.trustLevel}, score=${hit.score})`).join(" | ") || "None"}`
    );
  });

program
  .command("context-get")
  .argument("<id>", "Context entry id")
  .argument("[target]", "Repository that owns the output context", ".")
  .option("-o, --output <dir>", "Output directory")
  .action(async (
    id: string,
    target: string,
    options: { output?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.contextGet(targetPath, outputPath, id);
    console.log(`Context artifact: ${result.artifactPath}`);
    console.log(`Cache: ${result.cachePath}`);
    console.log(`Title: ${result.entry.title}`);
    console.log(`Trust: ${result.entry.trustLevel}`);
  });

program
  .command("context-sources")
  .argument("[target]", "Repository that owns the output context", ".")
  .option("-o, --output <dir>", "Output directory")
  .action(async (
    target: string,
    options: { output?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.contextSources(targetPath, outputPath);
    console.log(`Context sources report: ${result.reportPath}`);
    console.log(
      `Sources: ${result.sources.map((source) => `${source.source}(${source.trustLevel}, entries=${source.entries})`).join(" | ") || "None"}`
    );
  });

program
  .command("ecosystem-radar")
  .argument("[target]", "Repository that owns the output context", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("--limit <n>", "Maximum additional discovered repositories to materialize", "6")
  .option("--bucket <id>", "Only run a specific radar bucket")
  .option("--seed-only", "Refresh only the curated seed repositories")
  .action(async (
    target: string,
    options: { output?: string; limit?: string; bucket?: string; seedOnly?: boolean }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const parsedLimit = Number.parseInt(options.limit ?? "6", 10);
    const result = await orchestrator.ecosystemRadar(targetPath, outputPath, {
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 6,
      bucketId: options.bucket,
      seedOnly: options.seedOnly ?? false
    });
    console.log(`Ecosystem radar report: ${result.reportPath}`);
    console.log(`Cache: ${result.cachePath}`);
    console.log(
      `Candidates: ${result.candidates.map((candidate) => `${candidate.repoFullName}(score=${candidate.score})`).join(" | ") || "None"}`
    );
  });

program
  .command("architecture-plan")
  .argument("[target]", "Repository to generate architecture evidence plan", ".")
  .option("-o, --output <dir>", "Output directory")
  .description("Generate architecture evidence artifacts and temporary execution context.")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.architecturePlan(targetPath, outputPath);
    console.log(`Architecture plan: ${result.planDir}`);
    console.log(`Blueprint: ${result.blueprintPath}`);
    console.log(`State: ${result.statePath}`);
    console.log(`Claude context: ${result.claudeContextPath}`);
    console.log(`Memory: ${result.memoryPath}`);
  });

program
  .command("plan-improvements")
  .argument("[target]", "Repository to turn into a persistent improvement plan", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("-t, --trigger <trigger>", "Governance trigger")
  .action(async (
    target: string,
    options: { output?: string; trigger?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.planImprovements(targetPath, outputPath, resolveTrigger(options.trigger));
    console.log(`Improvement plan: ${result.planDir}`);
    console.log(`Summary: ${result.summaryPath}`);
    console.log(`State: ${result.statePath}`);
    console.log(`Known risks: ${result.risksPath}`);
    console.log(`Roadmap: ${result.roadmapPath}`);
    console.log(`Tracks: ${result.tracksPath}`);
  });

program
  .command("firewall")
  .argument("[target]", "Repository to assess with the agent firewall", ".")
  .option("-o, --output <dir>", "Output directory")
  .option("-t, --trigger <trigger>", "Governance trigger")
  .action(async (
    target: string,
    options: { output?: string; trigger?: string }
  ) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const result = await orchestrator.inspectFirewall(targetPath, outputPath, resolveTrigger(options.trigger));
    console.log(`Firewall report: ${result.firewall.reportPath}`);
    console.log(`Firewall policy: ${result.firewall.policyPath}`);
    console.log(`Task packets: ${result.firewall.packets.length}`);
    console.log(`Allowed: ${result.firewall.stats.allowed}`);
    console.log(`Review required: ${result.firewall.stats.reviewRequired}`);
    console.log(`Blocked: ${result.firewall.stats.blocked}`);
  });

program
  .command("report")
  .argument("[target]", "Directory containing generated output", ".")
  .option("-o, --output <dir>", "Output directory")
  .action(async (target: string, options: { output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = options.output ? resolveTarget(options.output) : targetPath;
    const manifest = await orchestrator.collectReportManifest(outputPath);
    console.log(JSON.stringify(manifest, null, 2));
  });

program
  .command("annotate")
  .argument("<target>", "Repository that owns the generated context")
  .argument("[note]", "Persistent local note to save for future runs")
  .option("--scope <scope>", "Annotation scope", "repo")
  .option("--list", "List all annotations")
  .option("--clear", "Clear the annotation for the selected scope")
  .option("-o, --output <dir>", "Output directory")
  .action(async (target: string, note: string | undefined, options: { scope?: string; list?: boolean; clear?: boolean; output?: string }) => {
    const targetPath = resolveTarget(target);
    const outputPath = resolveOutput(targetPath, options.output);
    const scope = options.scope ?? "repo";

    if (options.list) {
      const annotations = await orchestrator.listAnnotations(targetPath, outputPath);
      if (annotations.length === 0) {
        console.log("No annotations recorded.");
        return;
      }

      for (const annotation of annotations) {
        console.log(`[${annotation.scope}] ${annotation.updatedAt}`);
        console.log(annotation.note);
        console.log("");
      }
      return;
    }

    if (options.clear) {
      const cleared = await orchestrator.clearAnnotation(targetPath, outputPath, scope);
      console.log(cleared ? `Cleared annotation for ${scope}` : `No annotation found for ${scope}`);
      return;
    }

    if (!note) {
      const annotation = await orchestrator.readAnnotation(targetPath, outputPath, scope);
      if (!annotation) {
        console.log(`No annotation found for ${scope}`);
        return;
      }

      console.log(`[${annotation.scope}] ${annotation.updatedAt}`);
      console.log(annotation.note);
      return;
    }

    const annotation = await orchestrator.annotateTarget(targetPath, outputPath, {
      scope,
      note
    });
    console.log(`Saved annotation for ${annotation.scope}`);
  });

program
  .command("feedback")
  .argument("<target>", "Repository that owns the generated governance memory")
  .requiredOption("--agent <agentId>", "Agent identifier")
  .requiredOption("--task <taskId>", "Task identifier")
  .requiredOption("--context <context>", "Learning context")
  .requiredOption("--problem <problem>", "Detected problem")
  .requiredOption("--action <action>", "Action taken")
  .requiredOption("--outcome <outcome>", "Learning outcome")
  .option("--confidence <score>", "Confidence score", "0.8")
  .option("-o, --output <dir>", "Output directory")
  .action(
    async (
      target: string,
      options: {
        agent: string;
        task: string;
        context: string;
        problem: string;
        action: string;
        outcome: LearningOutcome;
        confidence: string;
        output?: string;
      }
    ) => {
      const targetPath = resolveTarget(target);
      const outputPath = resolveOutput(targetPath, options.output);
      const record = await orchestrator.recordFeedback(targetPath, outputPath, {
        agentId: options.agent,
        taskId: options.task,
        context: options.context,
        detectedProblem: options.problem,
        actionTaken: options.action,
        outcome: options.outcome,
        confidenceScore: Number(options.confidence)
      });
      console.log(`Recorded learning ${record.lessonId} for ${record.agentId}`);
    }
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
