#!/usr/bin/env node
import path from "node:path";

import { Command } from "commander";

import { AIRouter } from "../core/ai_router/router";
import { ProjectBrainOrchestrator } from "../core/orchestrator/main";
import { setLoggerOptions, StructuredLogger } from "../shared/logger";
import type { EcosystemAnalysisResult, GovernanceTrigger, LearningOutcome, OrchestrationResult } from "../shared/types";

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
    "security-advisory": "security-audit",
    "architecture-review": "architecture-review",
    "incident-detection": "incident-detection",
    "dependency-update": "dependency-update"
  };

  if (trigger && aliases[trigger]) {
    return aliases[trigger];
  }

  return "manual";
}

function isEcosystemResult(
  result: OrchestrationResult | EcosystemAnalysisResult
): result is EcosystemAnalysisResult {
  return "repositories" in result && "knowledgeGraphPath" in result;
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
    console.log("Local models available:");
    if (inventory.localModelsAvailable.length === 0) {
      console.log("- None detected via Ollama");
    } else {
      for (const model of inventory.localModelsAvailable) {
        console.log(`- ${model}`);
      }
    }
    console.log(`Configured local model: ${inventory.config.localModel}`);
    console.log(`Configured fallback model: ${inventory.config.fallbackModel}`);
    console.log("Cloud model configured:");
    console.log(`- provider: ${inventory.cloudConfigured.provider}`);
    console.log(`- model: ${inventory.cloudConfigured.model}`);
    console.log("Routing rules:");
    for (const [task, route] of Object.entries(inventory.routing)) {
      console.log(`- ${task}: ${route}`);
    }
    console.log(`Offline ready: ${inventory.offlineReady ? "yes" : "no"}`);
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
