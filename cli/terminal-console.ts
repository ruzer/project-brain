import path from "node:path";
import process from "node:process";
import { createInterface, type Interface } from "node:readline/promises";

import type { AIRouter } from "../core/ai_router/router";
import type { ProjectBrainOrchestrator } from "../core/orchestrator/main";
import { getWorkflowDefinition, type WorkflowId } from "../core/workflow_registry";
import { setLoggerOptions } from "../shared/logger";
import type {
  AskResult,
  CodeGraphBuildResult,
  ArchitecturePlanResult,
  ContextLiteResult,
  DoctorResult,
  EcosystemAnalysisResult,
  FactQueryResult,
  FirewallInspectionResult,
  GovernanceTrigger,
  HarnessAuditResult,
  ImpactAnalysisResult,
  ImprovementPlanResult,
  OrchestrationResult,
  ResumeResult,
  RunbookResult,
  SecurityAuditResult,
  StartResult,
  StatusResult,
  SwarmEngine,
  SwarmRunResult
} from "../shared/types";

type WorkflowChoice =
  | "start"
  | "doctor"
  | "status"
  | "resume"
  | "security-audit"
  | "analyze"
  | "weekly"
  | "context-lite"
  | "ask"
  | "fact-query"
  | "runbook"
  | "harness-audit"
  | "swarm"
  | "self-improve"
  | "code-graph"
  | "impact-radius"
  | "review-delta"
  | "architecture-plan"
  | "firewall"
  | "plan-improvements"
  | "report";

type MenuChoice = "config" | "paths" | "executive-summary" | "swarm" | "run" | "models" | "setup" | "exit";
type SwarmPreset = "custom" | "cheap" | "balanced" | "thorough";

interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface TerminalSessionState {
  targetPath: string;
  outputPath: string;
  trigger: GovernanceTrigger;
  verbose: boolean;
  ollamaTimeoutMs?: number;
  swarmEngine: SwarmEngine;
  parallelism?: number;
  chunkSize?: number;
  taskTimeoutMs?: number;
  plannerTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  runTimeoutMs?: number;
  maxQueuedTasks?: number;
  maxRetries?: number;
}

interface LaunchTerminalConsoleOptions {
  orchestrator: ProjectBrainOrchestrator;
  aiRouter: AIRouter;
  initialSession?: Partial<TerminalSessionState>;
  cwd?: string;
}

const MAIN_MENU: ChoiceOption<MenuChoice>[] = [
  { value: "run", label: "Inicio recomendado / ejecutar workflow" },
  { value: "executive-summary", label: "Ver resumen ejecutivo" },
  { value: "config", label: "Ver configuracion actual" },
  { value: "paths", label: "Configurar target y output" },
  { value: "swarm", label: "Configurar analisis con agentes" },
  { value: "models", label: "Ver modelos y routing" },
  { value: "setup", label: "Ver setup local y toolchains open source" },
  { value: "exit", label: "Salir" }
];

function workflowLabel(workflowId: WorkflowId, fallback: string): string {
  const definition = getWorkflowDefinition(workflowId);
  return `${fallback}: ${definition.humanLabel}`;
}

const WORKFLOW_MENU: ChoiceOption<WorkflowChoice>[] = [
  { value: "start", label: workflowLabel("start", "Inicio guiado") },
  { value: "status", label: "Ver estado y siguiente paso" },
  { value: "resume", label: workflowLabel("resume", "Continuar") },
  { value: "runbook", label: workflowLabel("runbook", "Preparar ejecucion barata") },
  { value: "harness-audit", label: workflowLabel("harness-audit", "Revisar memoria y costos") },
  { value: "fact-query", label: workflowLabel("fact-query", "Buscar en memoria local") },
  { value: "swarm", label: workflowLabel("swarm", "Analizar con agentes") },
  { value: "architecture-plan", label: "Generar plan de arquitectura" },
  { value: "plan-improvements", label: workflowLabel("plan-improvements", "Crear plan ejecutivo persistente") },
  { value: "doctor", label: workflowLabel("doctor", "Revisar entorno local") },
  { value: "code-graph", label: workflowLabel("code-graph", "Construir mapa factual") },
  { value: "firewall", label: workflowLabel("firewall", "Revisar limites de agentes") },
  { value: "ask", label: workflowLabel("ask", "Pedir algo en lenguaje natural") },
  { value: "security-audit", label: "Auditoria de seguridad" },
  { value: "analyze", label: "Analisis completo legacy" },
  { value: "weekly", label: "Reporte semanal" },
  { value: "context-lite", label: "Contexto ligero" },
  { value: "self-improve", label: "Auto-mejora con swarm" },
  { value: "impact-radius", label: "Impacto de cambios" },
  { value: "review-delta", label: workflowLabel("review-delta", "Revisar delta git") },
  { value: "report", label: "report manifest" }
];

const TRIGGER_CHOICES: ChoiceOption<GovernanceTrigger>[] = [
  { value: "manual", label: "manual" },
  { value: "repository-change", label: "repository-change" },
  { value: "weekly-review", label: "weekly-review" },
  { value: "security-audit", label: "security-audit" },
  { value: "security-advisory", label: "security-advisory" },
  { value: "architecture-review", label: "architecture-review" },
  { value: "incident-detection", label: "incident-detection" },
  { value: "dependency-update", label: "dependency-update" }
];

const DEFAULT_OUTPUT_DIR_NAME = "BRAIN";

const SWARM_ENGINE_CHOICES: ChoiceOption<SwarmEngine>[] = [
  { value: "bounded", label: "bounded" },
  { value: "deepagents", label: "deepagents" }
];

const SWARM_PRESET_CHOICES: ChoiceOption<SwarmPreset>[] = [
  { value: "cheap", label: "Barato: rapido/economico, pocas tareas" },
  { value: "balanced", label: "Balanceado: recomendado, mejor cobertura" },
  { value: "thorough", label: "Profundo: mas lento/caro, maxima cobertura" },
  { value: "custom", label: "Avanzado: configurar manualmente" }
];

export function createDefaultTerminalSession(cwd: string): TerminalSessionState {
  const resolvedCwd = path.resolve(cwd);
  return {
    targetPath: resolvedCwd,
    outputPath: path.join(resolvedCwd, DEFAULT_OUTPUT_DIR_NAME),
    trigger: "manual",
    verbose: false,
    swarmEngine: "bounded"
  };
}

export function summarizeTerminalSession(state: TerminalSessionState): string[] {
  return [
    `Target: ${state.targetPath}`,
    `Output: ${state.outputPath}`,
    `Trigger: ${state.trigger}`,
    `Verbose logs: ${state.verbose ? "on" : "off"}`,
    `Ollama timeout: ${state.ollamaTimeoutMs ?? "default"}`,
    [
      "Swarm defaults:",
      `engine=${state.swarmEngine}`,
      `parallel=${state.parallelism ?? "auto"}`,
      `chunkSize=${state.chunkSize ?? "auto"}`,
      `taskTimeoutMs=${state.taskTimeoutMs ?? "auto"}`,
      `plannerTimeoutMs=${state.plannerTimeoutMs ?? "auto"}`,
      `synthesisTimeoutMs=${state.synthesisTimeoutMs ?? "auto"}`,
      `runTimeoutMs=${state.runTimeoutMs ?? "auto"}`,
      `maxQueuedTasks=${state.maxQueuedTasks ?? "auto"}`,
      `maxRetries=${state.maxRetries ?? "auto"}`
    ].join(" ")
  ];
}

export async function launchTerminalConsole(options: LaunchTerminalConsoleOptions): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("project-brain console requires an interactive terminal.");
  }

  const cwd = options.cwd ?? process.cwd();
  const session: TerminalSessionState = {
    ...createDefaultTerminalSession(cwd),
    ...options.initialSession
  };
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("");
    console.log("project-brain terminal console");
    console.log("Entrada guiada para analizar, continuar, buscar hechos y revisar pendientes sin recordar comandos internos.");

    while (true) {
      console.log("");
      console.log("Session");
      for (const line of summarizeTerminalSession(session)) {
        console.log(`- ${line}`);
      }
      console.log("");

      const action = await promptChoice(rl, "Menu principal", MAIN_MENU, "run");
      if (action === "exit") {
        console.log("Console closed.");
        return;
      }

      try {
        switch (action) {
          case "config":
            await configureGeneralDefaults(rl, session);
            break;
          case "paths":
            await configurePaths(rl, session, cwd);
            break;
          case "executive-summary": {
            const result = await options.orchestrator.status(session.targetPath, session.outputPath);
            printExecutiveSummaryShortcut(result);
            break;
          }
          case "swarm":
            await configureSwarmDefaults(rl, session);
            break;
          case "run":
            await runWorkflow(rl, session, options.orchestrator);
            break;
          case "models":
            await showModels(options.aiRouter);
            break;
          case "setup":
            await showRuntimeSetup(session, options.orchestrator);
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Console action failed: ${message}`);
      }
    }
  } finally {
    rl.close();
  }
}

function isEcosystemResult(result: OrchestrationResult | EcosystemAnalysisResult): result is EcosystemAnalysisResult {
  return "repositories" in result && "knowledgeGraphPath" in result;
}

async function configurePaths(rl: Interface, session: TerminalSessionState, cwd: string): Promise<void> {
  console.log("");
  console.log("Configurar target y output");
  const targetInput = await promptLine(rl, "Target repo/workspace", session.targetPath);
  const nextTarget = path.resolve(cwd, targetInput);
  const outputInput = await promptLine(rl, "Output dir", session.outputPath);
  session.targetPath = nextTarget;
  session.outputPath = path.resolve(cwd, outputInput);
}

async function configureGeneralDefaults(rl: Interface, session: TerminalSessionState): Promise<void> {
  console.log("");
  console.log("Configuracion general");
  session.trigger = await promptChoice(rl, "Trigger por defecto", TRIGGER_CHOICES, session.trigger);
  session.verbose = await promptYesNo(rl, "Verbose logs", session.verbose);
  session.ollamaTimeoutMs = await promptOptionalInteger(rl, "Ollama timeout ms", session.ollamaTimeoutMs);
}

async function configureSwarmDefaults(rl: Interface, session: TerminalSessionState): Promise<void> {
  console.log("");
  console.log("Configuracion del analisis con agentes");
  session.swarmEngine = await promptChoice(rl, "Motor", SWARM_ENGINE_CHOICES, session.swarmEngine);
  const preset = await promptChoice(rl, "Preset", SWARM_PRESET_CHOICES, "balanced");
  if (preset !== "custom") {
    applySwarmPreset(session, preset);
    console.log(`Costo seleccionado: ${describeSwarmCost(session)}`);
    return;
  }
  session.parallelism = await promptOptionalInteger(rl, "Trabajo en paralelo", session.parallelism);
  session.chunkSize = await promptOptionalInteger(rl, "Alcance por tarea", session.chunkSize);
  session.taskTimeoutMs = await promptOptionalInteger(rl, "Limite de tiempo por tarea ms", session.taskTimeoutMs);
  session.plannerTimeoutMs = await promptOptionalInteger(rl, "Limite de planeacion ms", session.plannerTimeoutMs);
  session.synthesisTimeoutMs = await promptOptionalInteger(rl, "Limite de sintesis ms", session.synthesisTimeoutMs);
  session.runTimeoutMs = await promptOptionalInteger(rl, "Limite total ms", session.runTimeoutMs);
  session.maxQueuedTasks = await promptOptionalInteger(rl, "Maximo de tareas", session.maxQueuedTasks);
  session.maxRetries = await promptOptionalInteger(rl, "Reintentos", session.maxRetries);
}

function describeSwarmCost(session: TerminalSessionState): string {
  return `tiempo max ${Math.round((session.runTimeoutMs ?? 0) / 60_000)} min, tareas ${session.maxQueuedTasks ?? "auto"}, reintentos ${session.maxRetries ?? "auto"}`;
}

function applySwarmPreset(session: TerminalSessionState, preset: Exclude<SwarmPreset, "custom">): void {
  if (preset === "cheap") {
    session.parallelism = 2;
    session.chunkSize = 1;
    session.taskTimeoutMs = 90_000;
    session.plannerTimeoutMs = 60_000;
    session.synthesisTimeoutMs = 60_000;
    session.runTimeoutMs = 120_000;
    session.maxQueuedTasks = 4;
    session.maxRetries = 0;
    return;
  }

  if (preset === "balanced") {
    session.parallelism = undefined;
    session.chunkSize = 1;
    session.taskTimeoutMs = 120_000;
    session.plannerTimeoutMs = 80_000;
    session.synthesisTimeoutMs = 90_000;
    session.runTimeoutMs = 180_000;
    session.maxQueuedTasks = 6;
    session.maxRetries = 1;
    return;
  }

  session.parallelism = 4;
  session.chunkSize = 2;
  session.taskTimeoutMs = 180_000;
  session.plannerTimeoutMs = 120_000;
  session.synthesisTimeoutMs = 120_000;
  session.runTimeoutMs = 360_000;
  session.maxQueuedTasks = 12;
  session.maxRetries = 1;
}

async function runWorkflow(
  rl: Interface,
  session: TerminalSessionState,
  orchestrator: ProjectBrainOrchestrator
): Promise<void> {
  applyRuntimeToggles(session);
  const workflow = await promptChoice(rl, "Workflow", WORKFLOW_MENU, "start");

  switch (workflow) {
    case "start": {
      const intent = await promptLine(rl, "Objetivo", "optimize analysis and cost");
      const withSwarm = await promptYesNo(rl, "Ejecutar swarm tambien", false);
      const result = await orchestrator.start(session.targetPath, session.outputPath, intent, { withSwarm });
      printStartResult(result);
      return;
    }
    case "doctor": {
      const result = await orchestrator.doctor(session.targetPath, session.outputPath);
      printDoctorResult(result);
      return;
    }
    case "status": {
      const result = await orchestrator.status(session.targetPath, session.outputPath);
      printStatusResult(result);
      return;
    }
    case "resume": {
      const result = await orchestrator.resume(session.targetPath, session.outputPath);
      printResumeResult(result);
      return;
    }
    case "analyze": {
      const result = await orchestrator.analyzeScope(session.targetPath, session.outputPath, session.trigger);
      printAnalyzeResult(result);
      return;
    }
    case "security-audit": {
      const result = await orchestrator.securityAudit(session.targetPath, session.outputPath, session.trigger);
      printSecurityAuditResult(result);
      return;
    }
    case "weekly": {
      const result = await orchestrator.generateWeeklyScope(session.targetPath, session.outputPath);
      printWeeklyResult(result);
      return;
    }
    case "context-lite": {
      const result = await orchestrator.contextLite(session.targetPath, session.outputPath);
      printContextLiteResult(result);
      return;
    }
    case "ask": {
      const intent = await promptRequiredLine(rl, "Intent");
      const result = await orchestrator.ask(session.targetPath, session.outputPath, intent);
      printAskResult(result);
      return;
    }
    case "fact-query": {
      const query = await promptRequiredLine(rl, "Busqueda en memoria");
      const result = await orchestrator.factQuery(session.targetPath, session.outputPath, query);
      printFactQueryResult(result);
      return;
    }
    case "runbook": {
      const intent = await promptLine(rl, "Objetivo", "optimize analysis and cost");
      const result = await orchestrator.runbook(session.targetPath, session.outputPath, intent);
      printRunbookResult(result);
      return;
    }
    case "harness-audit": {
      const result = await orchestrator.harnessAudit(session.targetPath, session.outputPath);
      printHarnessAuditResult(result);
      return;
    }
    case "swarm": {
      const intent = await promptRequiredLine(rl, "Swarm intent");
      const result = await orchestrator.swarm(session.targetPath, session.outputPath, intent, {
        engine: session.swarmEngine,
        parallelism: session.parallelism,
        chunkSize: session.chunkSize,
        taskTimeoutMs: session.taskTimeoutMs,
        plannerTimeoutMs: session.plannerTimeoutMs,
        synthesisTimeoutMs: session.synthesisTimeoutMs,
        runTimeoutMs: session.runTimeoutMs,
        maxQueuedTasks: session.maxQueuedTasks,
        maxRetries: session.maxRetries
      });
      printSwarmResult(result);
      return;
    }
    case "self-improve": {
      const intent = await promptLine(rl, "Override intent (optional)");
      const result = await orchestrator.selfImprove(
        session.targetPath,
        session.outputPath,
        intent.trim().length > 0 ? intent : undefined
      );
      printSwarmResult(result, "Self-improve");
      return;
    }
    case "code-graph": {
      const result = await orchestrator.buildCodeGraph(session.targetPath, session.outputPath);
      printCodeGraphResult(result);
      return;
    }
    case "impact-radius": {
      const filesInput = await promptLine(rl, "Changed files CSV (optional)");
      const baseRef = await promptLine(rl, "Base ref", "HEAD~1");
      const headRef = await promptLine(rl, "Head ref", "HEAD");
      const result = await orchestrator.analyzeImpact(session.targetPath, session.outputPath, {
        files: filesInput
          .split(",")
          .map((filePath) => filePath.trim())
          .filter(Boolean),
        baseRef,
        headRef
      });
      printImpactResult(result);
      return;
    }
    case "review-delta": {
      const baseRef = await promptLine(rl, "Base ref", "HEAD~1");
      const headRef = await promptLine(rl, "Head ref", "HEAD");
      const result = await orchestrator.reviewDelta(session.targetPath, session.outputPath, {
        baseRef,
        headRef
      });
      printReviewDeltaResult(result);
      return;
    }
    case "firewall": {
      const result = await orchestrator.inspectFirewall(session.targetPath, session.outputPath, session.trigger);
      printFirewallResult(result);
      return;
    }
    case "architecture-plan": {
      const result = await orchestrator.architecturePlan(session.targetPath, session.outputPath);
      printArchitecturePlanResult(result);
      return;
    }
    case "plan-improvements": {
      const result = await orchestrator.planImprovements(session.targetPath, session.outputPath, session.trigger);
      printImprovementPlanResult(result);
      return;
    }
    case "report": {
      const manifest = await orchestrator.collectReportManifest(session.outputPath);
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }
  }
}

async function showModels(aiRouter: AIRouter): Promise<void> {
  const inventory = await aiRouter.listModels();
  console.log("");
  console.log("Model inventory");
  console.log(`- Local model: ${inventory.config.localModel}`);
  console.log(`- Fallback model: ${inventory.config.fallbackModel}`);
  console.log(`- Reasoning model: ${inventory.config.reasoningModel}`);
  console.log(`- Cloud provider: ${inventory.cloudConfigured.provider}`);
  console.log(`- Cloud model: ${inventory.cloudConfigured.model}`);
  console.log(`- Offline mode: ${inventory.offlineMode ? "yes" : "no"}`);
  console.log(`- Offline ready: ${inventory.offlineReady ? "yes" : "no"}`);
  console.log("Ollama models:");
  if (inventory.availableModels.length === 0) {
    console.log("- None detected via Ollama");
    return;
  }

  for (const model of inventory.availableModels) {
    console.log(`- ${model.name} (${model.residency}, offline=${model.offlineCapable ? "yes" : "no"})`);
  }
}

async function showRuntimeSetup(
  session: TerminalSessionState,
  orchestrator: ProjectBrainOrchestrator
): Promise<void> {
  applyRuntimeToggles(session);
  const result = await orchestrator.doctor(session.targetPath, session.outputPath);
  console.log("");
  console.log("Runtime setup");
  for (const tier of ["required", "recommended", "optional"] as const) {
    const items = result.setupItems.filter((item) => item.tier === tier);
    if (items.length === 0) {
      continue;
    }
    const title =
      tier === "required"
        ? "Required local runtime"
        : tier === "recommended"
          ? "Recommended for this target"
          : "Optional open-source expansion";
    console.log(title);
    for (const item of items) {
      console.log(`- ${item.label}: ${item.status.toUpperCase()} - ${item.summary}`);
      console.log(`  Install / enable: ${item.installHint}`);
    }
    console.log("");
  }
}

function applyRuntimeToggles(session: TerminalSessionState): void {
  setLoggerOptions({ verbose: session.verbose });
  if (session.ollamaTimeoutMs) {
    process.env.OLLAMA_TIMEOUT_MS = String(session.ollamaTimeoutMs);
  } else {
    delete process.env.OLLAMA_TIMEOUT_MS;
  }
}

async function promptLine(rl: Interface, label: string, defaultValue = ""): Promise<string> {
  const prompt = defaultValue.length > 0 ? `${label} [${defaultValue}]: ` : `${label}: `;
  const answer = (await rl.question(prompt)).trim();
  return answer.length > 0 ? answer : defaultValue;
}

async function promptRequiredLine(rl: Interface, label: string): Promise<string> {
  while (true) {
    const answer = (await rl.question(`${label}: `)).trim();
    if (answer.length > 0) {
      return answer;
    }
    console.log("Este campo no puede quedar vacio.");
  }
}

async function promptOptionalInteger(rl: Interface, label: string, current?: number): Promise<number | undefined> {
  while (true) {
    const placeholder = current === undefined ? "auto" : String(current);
    const answer = (await rl.question(`${label} [${placeholder}; escribe auto para limpiar]: `)).trim().toLowerCase();
    if (answer.length === 0) {
      return current;
    }
    if (answer === "auto" || answer === "none" || answer === "default") {
      return undefined;
    }
    const parsed = Number(answer);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }
    console.log("Ingresa un entero positivo o 'auto'.");
  }
}

async function promptYesNo(rl: Interface, label: string, current: boolean): Promise<boolean> {
  while (true) {
    const answer = (await rl.question(`${label} [${current ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (answer.length === 0) {
      return current;
    }
    if (answer === "y" || answer === "yes" || answer === "s" || answer === "si") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    console.log("Responde y/n.");
  }
}

async function promptChoice<T extends string>(
  rl: Interface,
  label: string,
  options: ChoiceOption<T>[],
  defaultValue?: T
): Promise<T> {
  while (true) {
    console.log(label);
    options.forEach((option, index) => {
      const suffix = option.value === defaultValue ? " (default)" : "";
      console.log(`  ${index + 1}. ${option.label}${suffix}`);
    });
    const answer = (await rl.question("> ")).trim().toLowerCase();
    if (answer.length === 0 && defaultValue) {
      return defaultValue;
    }

    const numeric = Number.parseInt(answer, 10);
    if (Number.isFinite(numeric) && numeric >= 1 && numeric <= options.length) {
      return options[numeric - 1].value;
    }

    const directMatch = options.find((option) => option.value === answer);
    if (directMatch) {
      return directMatch.value;
    }

    console.log("Seleccion invalida. Usa el numero o el valor exacto.");
  }
}

function printDoctorResult(result: DoctorResult): void {
  console.log("");
  console.log("Doctor");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(
    `- Summary: passed=${result.summary.passed}, warnings=${result.summary.warnings}, failed=${result.summary.failed}`
  );
  console.log(`- Headline: ${result.summary.headline}`);
  for (const check of result.checks) {
    console.log(`- ${check.label}: ${check.status.toUpperCase()} - ${check.summary}`);
  }
  for (const tier of ["required", "recommended", "optional"] as const) {
    const items = result.setupItems.filter((item) => item.tier === tier);
    if (items.length === 0) {
      continue;
    }
    const title =
      tier === "required"
        ? "Required local runtime"
        : tier === "recommended"
          ? "Recommended for this target"
          : "Optional open-source expansion";
    console.log(`- ${title}:`);
    for (const item of items) {
      console.log(`  - ${item.label}: ${item.status.toUpperCase()} - ${item.installHint}`);
    }
  }
}

function printStatusResult(result: StatusResult): void {
  console.log("");
  console.log("Status");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Git: repo=${result.git.isGitRepo ? "yes" : "no"}, branch=${result.git.branch ?? "unknown"}`);
  console.log(`- Headline: ${result.summary.headline}`);
  console.log(`- Memory: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
  for (const artifact of result.artifacts) {
    console.log(`- ${artifact.label}: ${artifact.exists ? "present" : "missing"}`);
  }
}

function printExecutiveSummaryShortcut(result: StatusResult): void {
  console.log("");
  console.log("Resumen ejecutivo");
  console.log(`- Markdown: ${result.executiveSummary.reportPath}`);
  console.log(`- JSON: ${result.executiveSummary.memoryPath}`);
  console.log(`- Scopes: ${result.executiveSummary.status.scopeCount}`);
  console.log(`- Scopes listos: ${result.executiveSummary.status.completeFreshScopes}`);
  console.log(`- Scopes obsoletos: ${result.executiveSummary.status.staleScopes}`);
  console.log(`- Ultimo analisis: ${result.executiveSummary.status.latestSwarmHeadline ?? "Sin swarm registrado"}`);
}

function printResumeResult(result: ResumeResult): void {
  console.log("");
  console.log("Resume");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Executive summary: ${result.executiveSummary.reportPath}`);
  console.log(`- Stage: ${result.summary.stage}`);
  console.log(`- Headline: ${result.summary.headline}`);
  console.log(`- Memory readiness: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
  if (result.latestArtifact) {
    console.log(`- Latest artifact: ${result.latestArtifact.label}`);
  }
  for (const note of result.notes) {
    console.log(`- ${note}`);
  }
}

function printStartResult(result: StartResult): void {
  console.log("");
  console.log("Inicio guiado");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Executive summary: ${result.executiveSummary.reportPath}`);
  console.log(`- Headline: ${result.headline}`);
  console.log(`- Memory readiness: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
  for (const step of result.executedSteps) {
    console.log(`- [${step.status}] ${step.label}: ${step.summary}`);
  }
  if (result.nextCommand) {
    console.log(`- Siguiente: ${result.nextCommand}`);
  }
}

function printFactQueryResult(result: FactQueryResult): void {
  console.log("");
  console.log("Busqueda en memoria local");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Answer: ${result.answer}`);
  console.log(`- Evidence refs: ${result.evidenceRefs.join(", ") || "None"}`);
  if (result.unknowns.length > 0) {
    console.log(`- Unknowns: ${result.unknowns.join(" | ")}`);
  }
}

function printRunbookResult(result: RunbookResult): void {
  console.log("");
  console.log("Ruta barata");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Executive summary: ${result.executiveSummary.reportPath}`);
  for (const step of result.steps) {
    console.log(`- [${step.status}] ${step.id}. ${step.title}: ${step.command}`);
  }
}

function printHarnessAuditResult(result: HarnessAuditResult): void {
  console.log("");
  console.log("Memoria y costos");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Score: ${result.score}`);
  console.log(`- Token risk: ${result.tokenRisk}`);
  console.log(`- Memory readiness: ${result.memoryReadiness.status} - ${result.memoryReadiness.reason}`);
  for (const check of result.checks) {
    console.log(`- [${check.status}] ${check.label}: ${check.summary}`);
  }
  if (result.suggestedCommands.length > 0) {
    console.log(`- Siguiente: ${result.suggestedCommands[0]}`);
  }
}

function printAnalyzeResult(result: OrchestrationResult | EcosystemAnalysisResult): void {
  console.log("");
  console.log("Analyze");
  if (isEcosystemResult(result)) {
    console.log(`- Workspace: ${result.rootPath}`);
    console.log(`- Repositories: ${result.repositories.map((repository) => repository.repoName).join(", ")}`);
    console.log(`- Knowledge graph: ${result.knowledgeGraphPath}`);
    console.log(`- Ecosystem report: ${result.ecosystemReportPath}`);
    return;
  }

  console.log(`- Repo: ${result.context.repoName}`);
  console.log(`- AI_CONTEXT: ${result.context.memoryDir}`);
  console.log(`- Reports: ${result.context.reportsDir}`);
  console.log(`- Docs: ${result.context.docsDir}`);
}

function printWeeklyResult(result: OrchestrationResult | EcosystemAnalysisResult): void {
  console.log("");
  console.log("Weekly");
  if (isEcosystemResult(result)) {
    console.log(`- Repositories: ${result.repositories.map((repository) => repository.repoName).join(", ")}`);
    console.log(`- Ecosystem report: ${result.ecosystemReportPath}`);
    console.log(`- Knowledge graph: ${result.knowledgeGraphPath}`);
    return;
  }

  console.log(`- Weekly report: ${result.weeklyReportPath}`);
  console.log(`- Risk report: ${result.riskReportPath}`);
  if (result.reportQualityPath) {
    console.log(`- Report quality: ${result.reportQualityPath}`);
  }
}

function printContextLiteResult(result: ContextLiteResult): void {
  console.log("");
  console.log("Context-lite");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- AI_CONTEXT: ${result.context.memoryDir}`);
  console.log(`- Artifacts: ${result.artifactPaths.map((artifactPath) => path.basename(artifactPath)).join(", ")}`);
  for (const line of result.summary) {
    console.log(`- ${line}`);
  }
}

function printAskResult(result: AskResult): void {
  console.log("");
  console.log("Ask");
  console.log(`- Workflow: ${result.workflow}`);
  console.log(`- Brief: ${result.briefPath}`);
  console.log(`- Headline: ${result.headline}`);
  console.log(`- Reason: ${result.routingReason}`);
  console.log(`- Artifacts: ${result.artifacts.map((artifact) => `${artifact.label}=${artifact.path}`).join(" | ") || "None"}`);
  if (result.guidedExecution) {
    console.log(`- Guided: ${result.guidedExecution.label} -> ${result.guidedExecution.command}`);
  }
  if (result.aiAssistance) {
    console.log(
      `- AI assist: ${result.aiAssistance.model} (${result.aiAssistance.provider}, ${result.aiAssistance.residency}, profile=${result.aiAssistance.profile})`
    );
  }
  console.log(`- Next: ${result.followUps.join(" | ") || "None"}`);
}

function printSwarmResult(result: SwarmRunResult, label = "Swarm"): void {
  console.log("");
  console.log(label);
  console.log(`- Engine: ${result.engine}`);
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  console.log(`- Planner: ${result.planner.model} (${result.planner.provider}, ${result.planner.residency})`);
  console.log(
    `- Chunking: size=${result.chunking.selectedChunkSize}, scopeChunks=${result.chunking.scopeChunks}, queuedTasks=${result.chunking.queuedTasks}, scopeBias=${result.chunking.scopeBias}`
  );
  console.log(
    `- Resilience: runTimeoutMs=${result.resilience.runTimeoutMs}, taskTimeoutMs=${result.resilience.taskTimeoutMs}, plannerTimeoutMs=${result.resilience.plannerTimeoutMs}, synthesisTimeoutMs=${result.resilience.synthesisTimeoutMs}, maxRetries=${result.resilience.maxRetries}`
  );
  console.log(`- Parallelism: ${result.parallelism.selected} workers, pressure=${result.parallelism.pressure}`);
  console.log(`- Tasks: ${result.tasks.map((task) => `${task.title}[${task.profile}]`).join(" | ") || "None"}`);
  console.log(`- Headline: ${result.synthesis.headline}`);
  if (result.optimization) {
    console.log(
      `- Optimization: cacheHits=${result.optimization.cacheHits}, cacheMisses=${result.optimization.cacheMisses}, derivedQueued=${result.optimization.derivedTasksQueued}, derivedSkipped=${result.optimization.derivedTasksSkipped}`
    );
  }
}

function printSecurityAuditResult(result: SecurityAuditResult): void {
  const counts = result.findings.reduce<Record<string, number>>((accumulator, finding) => {
    accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
    return accumulator;
  }, {});

  console.log("");
  console.log("Security audit");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
  if (result.contextLiteReportPath) {
    console.log(`- Context-lite: ${result.contextLiteReportPath}`);
  }
  console.log(`- Verdict: ${result.verdict}`);
  console.log(`- Headline: ${result.headline}`);
  console.log(
    `- Findings: critical=${counts.critical ?? 0}, high=${counts.high ?? 0}, medium=${counts.medium ?? 0}, low=${counts.low ?? 0}, info=${counts.info ?? 0}`
  );
  console.log(`- Coverage gaps: ${result.coverage.filter((entry) => entry.status === "not-reviewed").length}`);
}

function printCodeGraphResult(result: CodeGraphBuildResult): void {
  console.log("");
  console.log("Code graph");
  console.log(`- Graph: ${result.graphPath}`);
  console.log(`- Files: ${result.graph.stats.files}`);
  console.log(`- Symbols: ${result.graph.stats.symbols}`);
  console.log(`- Nodes: ${result.graph.stats.nodes}`);
  console.log(`- Edges: ${result.graph.stats.edges}`);
}

function printImpactResult(result: ImpactAnalysisResult): void {
  console.log("");
  console.log("Impact radius");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Graph: ${result.graphPath}`);
  console.log(`- Changed files: ${result.changedFiles.join(", ") || "None"}`);
  console.log(`- Review set: ${result.reviewFiles.join(", ") || "None"}`);
  console.log(`- Related tests: ${result.impactedTests.join(", ") || "None"}`);
}

function printReviewDeltaResult(result: ImpactAnalysisResult): void {
  console.log("");
  console.log("Review delta");
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Changed files: ${result.changedFiles.join(", ") || "None"}`);
  console.log(`- Review set: ${result.reviewFiles.join(", ") || "None"}`);
  console.log(`- Related tests: ${result.impactedTests.join(", ") || "None"}`);
}

function printFirewallResult(result: FirewallInspectionResult): void {
  console.log("");
  console.log("Firewall");
  console.log(`- Report: ${result.firewall.reportPath}`);
  console.log(`- Policy: ${result.firewall.policyPath}`);
  console.log(`- Packets: ${result.firewall.packets.length}`);
  console.log(`- Allowed: ${result.firewall.stats.allowed}`);
  console.log(`- Review required: ${result.firewall.stats.reviewRequired}`);
  console.log(`- Blocked: ${result.firewall.stats.blocked}`);
}

function printImprovementPlanResult(result: ImprovementPlanResult): void {
  console.log("");
  console.log("Improvement plan");
  console.log(`- Plan dir: ${result.planDir}`);
  console.log(`- Summary: ${result.summaryPath}`);
  console.log(`- State: ${result.statePath}`);
  console.log(`- Risks: ${result.risksPath}`);
  console.log(`- Roadmap: ${result.roadmapPath}`);
  console.log(`- Tracks: ${result.tracksPath}`);
}

function printArchitecturePlanResult(result: ArchitecturePlanResult): void {
  console.log("");
  console.log("Architecture plan");
  console.log(`- Plan dir: ${result.planDir}`);
  console.log(`- Blueprint: ${result.blueprintPath}`);
  console.log(`- State: ${result.statePath}`);
  console.log(`- CLAUDE context: ${result.claudeContextPath}`);
  console.log(`- Memory: ${result.memoryPath}`);
}
