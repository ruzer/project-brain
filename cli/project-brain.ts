#!/usr/bin/env node
import path from "node:path";

import { Command } from "commander";

import { AIRouter } from "../core/ai_router/router";
import { ProjectBrainOrchestrator } from "../core/orchestrator/main";
import { setLoggerOptions, StructuredLogger } from "../shared/logger";
import type {
  CodebaseMapResult,
  ContextTrustLevel,
  EcosystemAnalysisResult,
  EcosystemCodebaseMapResult,
  GovernanceTrigger,
  LearningOutcome,
  OrchestrationResult,
  SwarmEngine
} from "../shared/types";

const program = new Command();
const orchestrator = new ProjectBrainOrchestrator();
const aiRouter = new AIRouter();
const logger = new StructuredLogger("cli");

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

function resolveTarget(target: string): string {
  return path.resolve(process.cwd(), target);
}

function resolveOutput(targetPath: string, output?: string): string {
  return output ? resolveTarget(output) : targetPath;
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
  .name("project-brain")
  .description("Analyze repositories, build project context, run specialist agents, and generate reports.")
  .version("0.1.0");

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
    printSuggestions(result.suggestions);
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
    console.log(`Status report: ${result.reportPath}`);
    console.log(`Status memory: ${result.memoryPath}`);
    console.log(`Git: repo=${result.git.isGitRepo ? "yes" : "no"}, branch=${result.git.branch ?? "unknown"}`);
    console.log(`Headline: ${result.summary.headline}`);
    for (const artifact of result.artifacts) {
      console.log(`- ${artifact.label}: ${artifact.exists ? "present" : "missing"}${artifact.updatedAt ? ` (${artifact.updatedAt})` : ""}`);
    }
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
    console.log(`Git: repo=${result.git.isGitRepo ? "yes" : "no"}, branch=${result.git.branch ?? "unknown"}`);
    console.log(`Stage: ${result.summary.stage}`);
    console.log(`Headline: ${result.summary.headline}`);
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
    console.log(`Build mode: ${result.graph.build.mode}`);
    console.log(`Files: ${result.graph.stats.files}`);
    console.log(`Symbols: ${result.graph.stats.symbols}`);
    console.log(`Nodes: ${result.graph.stats.nodes}`);
    console.log(`Edges: ${result.graph.stats.edges}`);
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
    const result = await orchestrator.swarm(targetPath, outputPath, intent, {
      engine: options.engine ? parseSwarmEngine(options.engine) : undefined,
      parallelism: options.parallel ? parsePositiveInteger(options.parallel, "parallel worker count") : undefined,
      chunkSize: options.chunkSize ? parsePositiveInteger(options.chunkSize, "chunk size") : undefined,
      taskTimeoutMs: options.taskTimeoutMs ? parsePositiveInteger(options.taskTimeoutMs, "task timeout") : undefined,
      plannerTimeoutMs: options.plannerTimeoutMs ? parsePositiveInteger(options.plannerTimeoutMs, "planner timeout") : undefined,
      synthesisTimeoutMs: options.synthesisTimeoutMs ? parsePositiveInteger(options.synthesisTimeoutMs, "synthesis timeout") : undefined,
      runTimeoutMs: options.runTimeoutMs ? parsePositiveInteger(options.runTimeoutMs, "run timeout") : undefined,
      maxQueuedTasks: options.maxQueuedTasks ? parsePositiveInteger(options.maxQueuedTasks, "max queued tasks") : undefined,
      maxRetries: options.maxRetries ? parsePositiveInteger(options.maxRetries, "max retries") : undefined
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
    const outputPath = resolveOutput(targetPath, options.output);
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
