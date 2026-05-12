import path from "node:path";

import { buildOrUpdateCodeGraphV2 } from "../../analysis/code_graph_v2";
import { analyzeImpactRadius } from "../../analysis/impact_radius";
import { MetricsCollector } from "../../analysis/metrics/metrics_collector";
import { buildRepositoryFactGraph } from "../../analysis/repository_fact_graph";
import { discoverRepositoryTargets, uniqueRepositoryNames } from "../../analysis/workspace_discovery";
import { AIRouter, type AIRouterRequest, type ModelInventory, type ModelSelection } from "../ai_router/router";
import { routeIntent } from "../intent_router";
import { writeCodebaseMapArtifacts } from "../codebase_map";
import { runDoctor } from "../doctor";
import { buildResume } from "../resume";
import { buildStatus } from "../status";
import { ContextBuilder } from "../context_builder";
import { writeContextLiteArtifacts } from "../context_lite";
import { WeeklyScheduler } from "../scheduler";
import { DiscoveryEngine } from "../discovery_engine";
import { runDeepAgentsSwarm } from "../deepagents_swarm";
import { runSecurityAudit } from "../security_audit";
import { runSwarm } from "../swarm_runtime";
import { AgentSelfGovernanceSystem } from "../../governance/self-governance-system";
import { buildKnowledgeGraphArtifacts } from "../../memory/knowledge_graph";
import { recordLearningArtifacts, recordSwarmLearningArtifacts } from "../../memory/learning_store";
import { runFactQuery } from "../../memory/fact_query";
import { preflightFacts } from "../../memory/preflight_facts";
import { writeMemoryBriefArtifacts } from "../../memory/memory_brief";
import { assessMemoryReadiness } from "../../memory/readiness";
import { runHarnessAudit } from "../../operations/harness_audit";
import { clearContextAnnotation, listContextAnnotations, readContextAnnotation, writeContextAnnotation } from "../../memory/annotations";
import { getContextRegistryEntry, listContextSources, searchContextRegistry } from "../../memory/context_registry";
import { runEcosystemRadar } from "../../memory/context_registry/ecosystem_radar";
import { updatePersistentMemory } from "../../memory/context_store";
import { writeImprovementPlanArtifacts } from "../../planning/improvement_plan";
import { writeArchitecturePlanArtifacts } from "../../planning/architecture_plan";
import { writeProjectSeedArtifacts } from "../../planning/project_seed";
import { buildRunbook } from "../../planning/runbook";
import { createCycleId, StructuredLogger, withLogContext } from "../../shared/logger";
import { ensureDir, readJsonSafe, readTextSafe, toPosixPath, uniqueSorted, walkDirectory, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  AgentReport,
  AskArtifact,
  AskResult,
  AskWorkflow,
  CodeGraphBuildResult,
  CodebaseMapResult,
  ContextLiteResult,
  FactQueryResult,
  HarnessAuditResult,
  ContextGetResult,
  ContextAnnotation,
  ContextSearchResult,
  ContextSourcesResult,
  EcosystemRadarResult,
  ImpactAnalysisResult,
  EcosystemCodebaseMapResult,
  EcosystemAnalysisResult,
  EcosystemRepositoryResult,
  FirewallInspectionResult,
  GovernanceTrigger,
  ImprovementPlanResult,
  ArchitecturePlanResult,
  OrchestrationResult,
  ProjectContext,
  ProjectSeedInput,
  ProjectSeedResult,
  ReportManifest,
  RepositoryTarget,
  DoctorResult,
  ResumeResult,
  SecurityAuditResult,
  StartResult,
  StartStep,
  StatusResult,
  RunbookResult,
  SwarmRunResult
} from "../../shared/types";

function highestRisk(agentReports: AgentReport[]): "low" | "medium" | "high" {
  if (agentReports.some((report) => report.riskLevel === "high")) {
    return "high";
  }
  if (agentReports.some((report) => report.riskLevel === "medium")) {
    return "medium";
  }
  return "low";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function containsPathLikeEvidence(value: string): boolean {
  return /`[^`]+\.[a-z0-9]+`|(?:^|[\s(])(?:src|app|lib|components|pages|routes|controllers|tests|docs|config)\/[^\s,;:()]+/i.test(value);
}

function collectGroundedFiles(context: ProjectContext, text: string): string[] {
  return context.discovery.files.filter((filePath) => text.includes(filePath)).slice(0, 8);
}

function detectGenericSignals(entries: string[]): string[] {
  return uniqueSorted(
    entries.filter(
      (entry) =>
        GENERIC_REPORT_PATTERNS.some((pattern) => pattern.test(entry)) &&
        !containsPathLikeEvidence(entry)
    )
  ).slice(0, 4);
}

async function assessAgentReportQuality(
  context: ProjectContext,
  report: AgentReport
): Promise<AgentReportQualityAssessment> {
  const reportContent = await readTextSafe(report.outputPath);
  const evidenceText = [report.summary, ...report.findings, ...report.recommendations, reportContent].join("\n");
  const groundedFiles = collectGroundedFiles(context, evidenceText);
  const genericSignals = detectGenericSignals([...report.findings, ...report.recommendations]);
  const notes: string[] = [];
  let score = 1;

  if (report.findings.length === 0 && report.recommendations.length === 0) {
    score -= 0.4;
    notes.push("No contiene findings ni recomendaciones accionables.");
  }

  if (!reportContent.trim()) {
    score -= 0.15;
    notes.push("El artefacto escrito del agente quedó vacío o no se pudo leer.");
  }

  if (groundedFiles.length === 0 && !containsPathLikeEvidence(evidenceText)) {
    score -= 0.45;
    notes.push("No cita archivos o superficies confirmadas del repositorio.");
  }

  if (genericSignals.length > 0 && groundedFiles.length === 0) {
    score -= 0.2;
    notes.push(`Las recomendaciones parecen genéricas: ${genericSignals.join(" | ")}`);
  }

  if (report.riskLevel !== "low" && report.findings.length === 0) {
    score -= 0.1;
    notes.push("Marca riesgo medio/alto sin findings concretos.");
  }

  return {
    report,
    score: clampScore(score),
    status: score >= 0.65 ? "accepted" : "review-required",
    notes: notes.length > 0 ? notes : ["El reporte cita evidencia suficiente para entrar al resumen operativo."],
    groundedFiles,
    genericSignals
  };
}

function buildReportQualityContent(
  context: ProjectContext,
  assessments: AgentReportQualityAssessment[],
  effectiveReports: AgentReport[],
  fellBackToRawReports: boolean
): string {
  const accepted = assessments.filter((assessment) => assessment.status === "accepted");
  const reviewRequired = assessments.filter((assessment) => assessment.status === "review-required");

  return `# Report Quality

## Summary

- Repository: ${context.repoName}
- Accepted reports: ${accepted.length}
- Review-required reports: ${reviewRequired.length}
- Effective reports used downstream: ${effectiveReports.length}
- Fallback to raw reports: ${fellBackToRawReports ? "yes" : "no"}

## Assessments

${assessments
  .map(
    (assessment) => `### ${assessment.report.title}

- Agent: ${assessment.report.agentId}
- Status: ${assessment.status}
- Score: ${assessment.score}
- Grounded files: ${assessment.groundedFiles.join(", ") || "None"}
- Notes:
${renderList(assessment.notes)}
`
  )
  .join("\n")}
`;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderArtifactList(artifacts: AskArtifact[]): string {
  return artifacts.length > 0
    ? artifacts.map((artifact) => `- ${artifact.label}: ${artifact.path}`).join("\n")
    : "- None";
}

interface AskAssistant {
  ask(input: AIRouterRequest): Promise<string>;
  selectModel(input: AIRouterRequest): Promise<ModelSelection>;
  listModels?: () => Promise<ModelInventory>;
}

interface AskAIEnhancement {
  headline?: string;
  summary: string[];
  followUps: string[];
  suggestedWorkflow?: AskWorkflow;
  modelSelection: ModelSelection;
}

interface AskGuidedExecution {
  label: string;
  command: string;
  headline: string;
  summary: string[];
  artifacts: AskArtifact[];
  followUps: string[];
}

interface ProjectBrainOrchestratorOptions {
  aiRouter?: AskAssistant;
}

interface AgentReportQualityAssessment {
  report: AgentReport;
  score: number;
  status: "accepted" | "review-required";
  notes: string[];
  groundedFiles: string[];
  genericSignals: string[];
}

const GENERIC_REPORT_PATTERNS = [
  /\bimprove (?:the )?(?:ux|ui|architecture|performance|security|reliability)\b/i,
  /\badd (?:more )?(?:tests|logging|monitoring|documentation)\b/i,
  /\brefactor (?:the )?(?:codebase|workflow|module|architecture)\b/i,
  /\benhance (?:the )?(?:workflow|platform|experience|quality)\b/i,
  /\boptimi[sz]e (?:the )?(?:app|application|system|performance)\b/i
];

function extractJsonObject(input: string): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function mergeUniqueStrings(...groups: string[][]): string[] {
  return [...new Set(groups.flat().filter((item) => item.trim().length > 0))];
}

function normalizeSuggestedWorkflow(value: unknown): AskWorkflow | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const allowed: AskWorkflow[] = [
    "resume-project",
    "discover-project",
    "security-audit",
    "critical-gaps",
    "review-latest-changes",
    "inspect-firewall",
    "build-code-graph"
  ];

  return allowed.includes(value as AskWorkflow) ? (value as AskWorkflow) : undefined;
}

function shouldUseAIAskAssist(intent: string, workflow: AskWorkflow): boolean {
  if (workflow === "security-audit") {
    return false;
  }

  const strategic = /estrateg|strategy|roadmap|stack|tecnolog|deploy|alcance|scope|arquitect|architecture|producto|product|idea|greenfield/i.test(
    intent
  );
  const exploratory = /quiero|ayudame|help me|necesito|define|definir|como seguimos|what should/i.test(intent);

  if (workflow === "discover-project") {
    return strategic || exploratory;
  }

  if (workflow === "resume-project") {
    return exploratory;
  }

  return strategic;
}

function hasAskArtifact(artifacts: AskArtifact[], label: string): boolean {
  return artifacts.some((artifact) => artifact.label === label);
}

function shouldAutoContinueAsk(intent: string, workflow: AskWorkflow): boolean {
  if (workflow !== "resume-project") {
    return false;
  }

  return /\b(resume|continue|retoma|continua|continuar|seguir|seguimos|donde nos quedamos|where.*left off)\b/i.test(intent);
}

export class ProjectBrainOrchestrator {
  private readonly logger = new StructuredLogger("orchestrator");
  private readonly discoveryEngine = new DiscoveryEngine();
  private readonly contextBuilder = new ContextBuilder();
  private readonly selfGovernance = new AgentSelfGovernanceSystem();
  private readonly scheduler = new WeeklyScheduler();
  private readonly metricsCollector = new MetricsCollector();
  private readonly aiRouter: AskAssistant;

  constructor(options: ProjectBrainOrchestratorOptions = {}) {
    this.aiRouter = options.aiRouter ?? new AIRouter();
  }

  private discoveryExclusions(targetPath: string, outputPath: string): string[] {
    const relativeOutput = toPosixPath(path.relative(targetPath, outputPath));

    if (!relativeOutput || relativeOutput === "." || relativeOutput.startsWith("../")) {
      return [];
    }

    return [relativeOutput];
  }

  async initTarget(targetPath: string, outputPath = targetPath): Promise<ProjectContext> {
    const discovery = await this.discoveryEngine.analyze(targetPath, {
      excludePaths: this.discoveryExclusions(targetPath, outputPath)
    });
    const context = await this.contextBuilder.build(discovery, outputPath);
    await writeMemoryBriefArtifacts(context);
    return context;
  }

  async mapTarget(targetPath: string, outputPath = targetPath): Promise<CodebaseMapResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const artifact = await writeCodebaseMapArtifacts(context);
    await writeMemoryBriefArtifacts(context);

    return {
      context,
      ...artifact
    };
  }

  async analyzeImpact(
    targetPath: string,
    outputPath = targetPath,
    options?: {
      files?: string[];
      baseRef?: string;
      headRef?: string;
    }
  ): Promise<ImpactAnalysisResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return analyzeImpactRadius(context, options);
  }

  async buildCodeGraph(targetPath: string, outputPath = targetPath): Promise<CodeGraphBuildResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const codeGraph = await buildOrUpdateCodeGraphV2(context);
    const factGraph = await buildRepositoryFactGraph(context, codeGraph.graph);
    await writeMemoryBriefArtifacts(context);

    return {
      ...codeGraph,
      factGraphPath: factGraph.graphPath,
      factReportPath: factGraph.reportPath,
      factGraph: factGraph.graph
    };
  }

  async contextLite(targetPath: string, outputPath = targetPath): Promise<ContextLiteResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const result = await writeContextLiteArtifacts(context);
    await writeMemoryBriefArtifacts(context);
    return result;
  }

  async factQuery(targetPath: string, outputPath = targetPath, query: string): Promise<FactQueryResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const result = await runFactQuery(context, query);
    await writeMemoryBriefArtifacts(context);
    return result;
  }

  async runbook(targetPath: string, outputPath = targetPath, intent: string): Promise<RunbookResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const result = await buildRunbook(context, intent);
    await writeMemoryBriefArtifacts(context);
    return result;
  }

  async harnessAudit(targetPath: string, outputPath = targetPath): Promise<HarnessAuditResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const result = await runHarnessAudit(context);
    await writeMemoryBriefArtifacts(context);
    return result;
  }

  async start(
    targetPath: string,
    outputPath = targetPath,
    intent = "optimize analysis and cost",
    options: { withSwarm?: boolean } = {}
  ): Promise<StartResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const outputFlag = `--output ${JSON.stringify(outputPath)}`;
    const targetArg = JSON.stringify(targetPath);
    const executedSteps: StartStep[] = [];
    let status = await buildStatus(context);
    const hasArtifact = (label: string): boolean => status.artifacts.some((artifact) => artifact.label === label && artifact.exists);
    const refreshStatus = async (): Promise<void> => {
      status = await buildStatus(context);
    };
    const addStep = (
      id: string,
      label: string,
      stepStatus: StartStep["status"],
      command: string,
      summary: string
    ): void => {
      executedSteps.push({
        id,
        label,
        status: stepStatus,
        command,
        summary
      });
    };

    if (status.summary.doctorStatus === "unknown" || status.summary.doctorStatus === "fail") {
      await this.doctor(targetPath, outputPath);
      addStep("doctor", "Revisar entorno local", "done", `project-brain doctor ${targetArg} ${outputFlag}`, "Se actualizo el diagnostico local.");
      await refreshStatus();
    } else {
      addStep("doctor", "Revisar entorno local", "skipped", `project-brain doctor ${targetArg} ${outputFlag}`, "Ya existe un diagnostico utilizable.");
    }

    if (!hasArtifact("Codebase Map")) {
      await writeCodebaseMapArtifacts(context);
      addStep("map-codebase", "Crear mapa del proyecto", "done", `project-brain map-codebase ${targetArg} ${outputFlag}`, "Se genero el mapa estructural.");
      await refreshStatus();
    } else {
      addStep("map-codebase", "Crear mapa del proyecto", "skipped", `project-brain map-codebase ${targetArg} ${outputFlag}`, "Ya existe mapa estructural.");
    }

    if (!hasArtifact("Repository Fact Graph")) {
      await this.buildCodeGraph(targetPath, outputPath);
      addStep("code-graph", "Crear hechos estructurales", "done", `project-brain code-graph ${targetArg} ${outputFlag}`, "Se genero el grafo factual.");
      await refreshStatus();
    } else {
      addStep("code-graph", "Crear hechos estructurales", "skipped", `project-brain code-graph ${targetArg} ${outputFlag}`, "Ya existe grafo factual.");
    }

    const factQuery = `${context.repoName} ${intent}`;
    if (!hasArtifact("Fact Query")) {
      await this.factQuery(targetPath, outputPath, factQuery);
      addStep("fact-query", "Buscar memoria factual", "done", `project-brain fact-query ${JSON.stringify(factQuery)} ${targetArg} ${outputFlag}`, "Se filtro memoria relevante sin usar modelo.");
      await refreshStatus();
    } else {
      addStep("fact-query", "Buscar memoria factual", "skipped", `project-brain fact-query ${JSON.stringify(factQuery)} ${targetArg} ${outputFlag}`, "Ya existe consulta factual reutilizable.");
    }

    if (!hasArtifact("Runbook")) {
      await this.runbook(targetPath, outputPath, intent);
      addStep("runbook", "Preparar ruta barata", "done", `project-brain runbook ${JSON.stringify(intent)} ${targetArg} ${outputFlag}`, "Se genero un runbook token-aware.");
      await refreshStatus();
    } else {
      addStep("runbook", "Preparar ruta barata", "skipped", `project-brain runbook ${JSON.stringify(intent)} ${targetArg} ${outputFlag}`, "Ya existe runbook.");
    }

    if (!hasArtifact("Harness Audit")) {
      await this.harnessAudit(targetPath, outputPath);
      addStep("harness-audit", "Auditar memoria y costos", "done", `project-brain harness-audit ${targetArg} ${outputFlag}`, "Se audito preparacion de memoria/costos.");
      await refreshStatus();
    } else {
      addStep("harness-audit", "Auditar memoria y costos", "skipped", `project-brain harness-audit ${targetArg} ${outputFlag}`, "Ya existe harness audit.");
    }

    if (!hasArtifact("Firewall")) {
      await this.inspectFirewall(targetPath, outputPath, "repository-change");
      addStep("firewall", "Revisar limites de agentes", "done", `project-brain firewall ${targetArg} --trigger repository-change ${outputFlag}`, "Se genero snapshot de firewall.");
      await refreshStatus();
    } else {
      addStep("firewall", "Revisar limites de agentes", "skipped", `project-brain firewall ${targetArg} --trigger repository-change ${outputFlag}`, "Ya existe firewall.");
    }

    if (hasArtifact("Swarm") && !hasArtifact("Improvement Plan")) {
      await this.planImprovements(targetPath, outputPath, "repository-change");
      addStep("plan-improvements", "Consolidar plan", "done", `project-brain plan-improvements ${targetArg} ${outputFlag}`, "Se convirtieron findings existentes en plan persistente.");
      await refreshStatus();
    } else if (!hasArtifact("Swarm") && options.withSwarm) {
      await this.swarm(targetPath, outputPath, intent, {
        engine: "bounded",
        chunkSize: 1,
        parallelism: 2,
        taskTimeoutMs: 90_000,
        plannerTimeoutMs: 60_000,
        synthesisTimeoutMs: 60_000,
        runTimeoutMs: 120_000,
        maxQueuedTasks: 4,
        maxRetries: 0
      });
      addStep("swarm", "Analizar con agentes", "done", `project-brain swarm ${JSON.stringify(intent)} ${targetArg} ${outputFlag} --preset cheap`, "Se ejecuto swarm porque se pidio --with-swarm.");
      await refreshStatus();
      if (!hasArtifact("Improvement Plan")) {
        await this.planImprovements(targetPath, outputPath, "repository-change");
        addStep("plan-improvements", "Consolidar plan", "done", `project-brain plan-improvements ${targetArg} ${outputFlag}`, "Se convirtieron findings del swarm en plan persistente.");
        await refreshStatus();
      }
    } else if (!hasArtifact("Swarm")) {
      addStep("swarm", "Analizar con agentes", "suggested", `project-brain swarm ${JSON.stringify(intent)} ${targetArg} ${outputFlag} --preset cheap`, "Listo para swarm, pero no se ejecuto para evitar gasto de tokens/modelos.");
    }

    const nextCommand = executedSteps.find((step) => step.status === "suggested")?.command ?? status.suggestions[0]?.command;
    const result: StartResult = {
      context,
      intent,
      reportPath: path.join(context.reportsDir, "start.md"),
      memoryPath: path.join(context.memoryDir, "start", "start.json"),
      headline: nextCommand ? "Start complete: base context is ready; one next action remains." : "Start complete: project-brain context is ready.",
      memoryReadiness: await assessMemoryReadiness(context),
      executiveSummary: status.executiveSummary,
      executedSteps,
      nextCommand,
      artifacts: status.artifacts,
      suggestions: status.suggestions
    };

    await writeFileEnsured(
      result.reportPath,
      `# Start

## Summary

- Repository: ${context.repoName}
- Intent: ${intent}
- Headline: ${result.headline}
- Memory readiness: ${result.memoryReadiness.status} (${result.memoryReadiness.reason})
- Executive summary: ${result.executiveSummary.reportPath}
- Next command: ${nextCommand ?? "None"}

## Steps

${executedSteps.map((step) => `- [${step.status}] ${step.label}: \`${step.command}\` - ${step.summary}`).join("\n")}
`
    );
    await writeJsonEnsured(result.memoryPath, {
      repoName: context.repoName,
      targetPath,
      outputPath,
      intent,
      headline: result.headline,
      memoryReadiness: result.memoryReadiness,
      executiveSummary: {
        reportPath: result.executiveSummary.reportPath,
        memoryPath: result.executiveSummary.memoryPath,
        status: result.executiveSummary.status
      },
      executedSteps,
      nextCommand,
      suggestions: status.suggestions
    });
    await writeMemoryBriefArtifacts(context);

    return result;
  }

  async securityAudit(
    targetPath: string,
    outputPath = targetPath,
    trigger: GovernanceTrigger = "security-audit"
  ): Promise<SecurityAuditResult> {
    const scope = await discoverRepositoryTargets(targetPath, outputPath);
    const firstRepository = scope.repositories[0];
    const primaryTargetPath = firstRepository?.targetPath ?? targetPath;
    const primaryOutputPath =
      scope.mode === "workspace" && firstRepository
        ? this.workspaceRepoOutputPath(outputPath, firstRepository)
        : outputPath;
    const scopeNote =
      scope.mode === "workspace" && firstRepository
        ? `Workspace detectado; la auditoría se ejecutó sobre el primer repositorio materializado: ${firstRepository.repoName} (${firstRepository.relativePath}).`
        : undefined;
    const context = await this.initTarget(primaryTargetPath, primaryOutputPath);
    const contextLite = await writeContextLiteArtifacts(context);
    const governanceRun = await this.selfGovernance.run(context, trigger);

    return runSecurityAudit(context, governanceRun, contextLite, {
      trigger,
      scopeNote
    });
  }

  async doctor(targetPath: string, outputPath = targetPath): Promise<DoctorResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return runDoctor(context, this.aiRouter);
  }

  async status(targetPath: string, outputPath = targetPath): Promise<StatusResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return buildStatus(context);
  }

  async resume(targetPath: string, outputPath = targetPath): Promise<ResumeResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return buildResume(context);
  }

  async reviewDelta(
    targetPath: string,
    outputPath = targetPath,
    options?: {
      baseRef?: string;
      headRef?: string;
    }
  ): Promise<ImpactAnalysisResult> {
    return this.analyzeImpact(targetPath, outputPath, {
      baseRef: options?.baseRef,
      headRef: options?.headRef
    });
  }

  async inspectFirewall(
    targetPath: string,
    outputPath = targetPath,
    trigger: GovernanceTrigger = "manual"
  ): Promise<FirewallInspectionResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const firewall = await this.selfGovernance.inspectFirewall(context, trigger);

    return {
      context,
      firewall
    };
  }

  private async buildAskAIEnhancement(
    intent: string,
    workflow: AskWorkflow,
    routingReason: string,
    scopeMode: "repository" | "workspace"
  ): Promise<AskAIEnhancement | undefined> {
    if (!shouldUseAIAskAssist(intent, workflow)) {
      return undefined;
    }

    const request: AIRouterRequest = {
      task: "intent-routing",
      profile: "planner",
      allowRemote: true,
      prompt: [
        "You are refining a user intent for project-brain.",
        "Do not invent repository facts.",
        "Interpret the request and improve the next step selection.",
        "Return JSON only with this shape:",
        '{ "headline": string, "summary": string[], "follow_ups": string[], "suggested_workflow": string | null }',
        `Intent: ${intent}`,
        `Current workflow: ${workflow}`,
        `Routing reason: ${routingReason}`,
        `Scope mode: ${scopeMode}`
      ].join("\n")
    };

    try {
      const modelSelection = await this.aiRouter.selectModel(request);
      const response = await this.aiRouter.ask(request);
      const parsed = extractJsonObject(response);
      if (!parsed) {
        return undefined;
      }

      return {
        headline: typeof parsed.headline === "string" ? parsed.headline : undefined,
        summary: normalizeStringList(parsed.summary),
        followUps: normalizeStringList(parsed.follow_ups),
        suggestedWorkflow: normalizeSuggestedWorkflow(parsed.suggested_workflow),
        modelSelection
      };
    } catch (error) {
      this.logger.warn("Ask AI enhancement unavailable", {
        action: "ask_ai_assist_unavailable",
        intent,
        workflow,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private async buildGuidedResumeExecution(
    targetPath: string,
    outputPath: string,
    stage: ResumeResult["summary"]["stage"],
    artifacts: AskArtifact[]
  ): Promise<AskGuidedExecution | undefined> {
    if (stage === "bootstrap") {
      const result = await this.doctor(targetPath, outputPath);
      return {
        label: "Doctor",
        command: `project-brain doctor . --output "${outputPath}"`,
        headline: "Continued from bootstrap into Doctor.",
        summary: [
          result.summary.headline,
          `Checks: passed=${result.summary.passed}, warnings=${result.summary.warnings}, failed=${result.summary.failed}`
        ],
        artifacts: [{ label: "Doctor report", path: result.reportPath }],
        followUps: result.suggestions.map((suggestion) => suggestion.command)
      };
    }

    if (stage === "doctor" && !hasAskArtifact(artifacts, "Codebase map summary")) {
      const result = await this.mapTarget(targetPath, outputPath);
      return {
        label: "Codebase Map",
        command: `project-brain map-codebase . --output "${outputPath}"`,
        headline: "Continued from Doctor into Codebase Map.",
        summary: [
          `Languages: ${result.context.discovery.languages.join(", ") || "Unknown"}`,
          `Frameworks: ${result.context.discovery.frameworks.join(", ") || "Unknown"}`,
          "Generated the repository map as the next structural step."
        ],
        artifacts: [
          { label: "Codebase map summary", path: result.summaryPath },
          { label: "Codebase map directory", path: result.codebaseMapDir }
        ],
        followUps: [
          'project-brain ask "dime que le falta criticamente"',
          'project-brain swarm "ayudame a mejorar este repo"',
          `project-brain status . --output "${outputPath}"`
        ]
      };
    }

    if (stage === "swarm" && !hasAskArtifact(artifacts, "Improvement plan summary")) {
      const result = await this.planImprovements(targetPath, outputPath, "manual");
      return {
        label: "Improvement Plan",
        command: `project-brain plan-improvements . --output "${outputPath}"`,
        headline: "Continued from Swarm into Improvement Plan.",
        summary: [
          "Converted the latest bounded analysis into a persistent roadmap.",
          `Plan summary: ${result.summaryPath}`,
          `Roadmap: ${result.roadmapPath}`
        ],
        artifacts: [
          { label: "Improvement plan summary", path: result.summaryPath },
          { label: "Improvement roadmap", path: result.roadmapPath }
        ],
        followUps: [
          `project-brain review-delta . --output "${outputPath}"`,
          `project-brain status . --output "${outputPath}"`,
          'project-brain ask "dime que le falta criticamente"'
        ]
      };
    }

    if (stage === "plan-improvements" && !hasAskArtifact(artifacts, "Impact report")) {
      const result = await this.reviewDelta(targetPath, outputPath, {
        baseRef: "HEAD~1",
        headRef: "HEAD"
      });
      return {
        label: "Review Delta",
        command: `project-brain review-delta . --output "${outputPath}"`,
        headline: "Continued from Improvement Plan into Review Delta.",
        summary: [
          `Changed files: ${result.changedFiles.join(", ") || "None"}`,
          `Review set size: ${result.reviewFiles.length}`,
          `Related tests: ${result.impactedTests.join(", ") || "None"}`
        ],
        artifacts: [
          { label: "Impact report", path: result.reportPath },
          { label: "Code graph", path: result.graphPath }
        ],
        followUps: [
          `project-brain status . --output "${outputPath}"`,
          'project-brain ask "dime que le falta criticamente"',
          'project-brain ask "inspecciona el firewall y aprobaciones"'
        ]
      };
    }

    return undefined;
  }

  async ask(targetPath: string, outputPath = targetPath, intent: string): Promise<AskResult> {
    const scope = await discoverRepositoryTargets(targetPath, outputPath);
    let route = routeIntent(intent);
    const briefPath = path.join(outputPath, "reports", "ask_brief.md");
    const firstRepository = scope.repositories[0];
    const primaryTargetPath = firstRepository?.targetPath ?? targetPath;
    const primaryOutputPath =
      scope.mode === "workspace" && firstRepository
        ? this.workspaceRepoOutputPath(outputPath, firstRepository)
        : outputPath;
    const scopeNote =
      scope.mode === "workspace" && firstRepository
        ? `The intent was run against the first repository in the workspace: ${firstRepository.repoName} (${firstRepository.relativePath}).`
        : undefined;
    const preflightContext = await this.initTarget(primaryTargetPath, primaryOutputPath);
    const preflight = await preflightFacts(preflightContext, intent, {
      scope: scope.mode === "workspace" ? firstRepository?.relativePath : "."
    });
    const aiEnhancement = await this.buildAskAIEnhancement(
      intent,
      route.workflow,
      route.reason,
      scope.mode === "workspace" ? "workspace" : "repository"
    );

    if (route.workflow === "discover-project" && aiEnhancement?.suggestedWorkflow) {
      const suggestedRoute = routeIntent(aiEnhancement.suggestedWorkflow.replace(/-/g, " "));
      route = {
        ...suggestedRoute,
        reason: `${route.reason} AI planner refinement suggested ${aiEnhancement.suggestedWorkflow}.`
      };
    }

    let headline = "";
    let summary: string[] = [];
    let artifacts: AskArtifact[] = [];
    let guidedExecution: AskGuidedExecution | undefined;

    if (route.workflow === "resume-project") {
      const result = await this.resume(primaryTargetPath, primaryOutputPath);
      headline = result.summary.headline;
      summary = [
        scopeNote ?? `Target path: ${primaryTargetPath}`,
        `Recovered stage: ${result.summary.stage}`,
        ...result.notes
      ].filter(Boolean);
      artifacts = [
        { label: "Resume report", path: result.reportPath },
        ...(result.latestArtifact ? [{ label: `Latest artifact (${result.latestArtifact.label})`, path: result.latestArtifact.path }] : [])
      ];
      route.followUps = mergeUniqueStrings(route.followUps, result.suggestions.map((suggestion) => suggestion.command)).slice(0, 6);

      if (shouldAutoContinueAsk(intent, route.workflow)) {
        guidedExecution = await this.buildGuidedResumeExecution(
          primaryTargetPath,
          primaryOutputPath,
          result.summary.stage,
          artifacts
        );

        if (guidedExecution) {
          headline = guidedExecution.headline;
          summary = mergeUniqueStrings(summary, guidedExecution.summary);
          artifacts = [...artifacts, ...guidedExecution.artifacts];
          route.followUps = mergeUniqueStrings(route.followUps, guidedExecution.followUps).slice(0, 6);
          route.followUps = route.followUps.filter((followUp) => followUp !== guidedExecution?.command);
        }
      }
    }

    if (route.workflow === "discover-project") {
      if (scope.mode === "workspace") {
        const result = await this.mapWorkspace(targetPath, outputPath, scope.repositories);
        headline = `Detected a workspace with ${result.repositories.length} repositories.`;
        summary = [
          `Root path: ${result.rootPath}`,
          `Repositories: ${result.repositories.map((repository) => repository.repoName).join(", ") || "None"}`,
          "Discovery completed and codebase maps were generated for each repository."
        ];
        artifacts = [
          { label: "Workspace codebase map", path: result.summaryPath },
          ...result.repositories.slice(0, 3).map((repository) => ({
            label: `${repository.repoName} summary`,
            path: repository.summaryPath
          }))
        ];
      } else {
        const result = await this.mapTarget(primaryTargetPath, primaryOutputPath);
        headline = `Detected ${result.context.repoName} and generated its repository map.`;
        summary = [
          `Languages: ${result.context.discovery.languages.join(", ") || "Unknown"}`,
          `Frameworks: ${result.context.discovery.frameworks.join(", ") || "Unknown"}`,
          `Testing: ${result.context.discovery.testing.join(", ") || "Not detected"}`,
          `Infrastructure: ${result.context.discovery.infrastructure.join(", ") || "Not detected"}`
        ];
        artifacts = [
          { label: "Codebase map summary", path: result.summaryPath },
          { label: "Codebase map directory", path: result.codebaseMapDir }
        ];
      }
    }

    if (route.workflow === "critical-gaps") {
      if (scope.mode === "workspace") {
        const result = await this.analyzeWorkspace(targetPath, outputPath, route.trigger, scope.repositories);
        headline = `Analyzed ${result.repositories.length} repositories for critical gaps.`;
        summary = [
          `Trigger used: ${route.trigger}`,
          `Repositories: ${result.repositories.map((repository) => repository.repoName).join(", ") || "None"}`,
          `Cross-repo intelligence artifacts were generated for the workspace.`
        ];
        artifacts = [
          { label: "Ecosystem report", path: result.ecosystemReportPath },
          { label: "Knowledge graph", path: result.knowledgeGraphPath },
          { label: "Runtime observability", path: result.runtimeObservabilityPath }
        ];
      } else {
        const result = await this.analyzeTarget(primaryTargetPath, primaryOutputPath, route.trigger);
        const approved = result.governanceSummary?.proposals.filter((proposal) => proposal.status === "APPROVED").length ?? 0;
        const review = result.governanceSummary?.proposals.filter((proposal) => proposal.status === "REQUIRES_HUMAN_REVIEW").length ?? 0;
        headline = `Analyzed ${result.context.repoName} for critical gaps and governance findings.`;
        summary = [
          `Languages: ${result.context.discovery.languages.join(", ") || "Unknown"}`,
          `Frameworks: ${result.context.discovery.frameworks.join(", ") || "Unknown"}`,
          `Agent reports: ${result.agentReports.length}`,
          `Proposals: approved=${approved}, review=${review}`
        ];
        artifacts = [
          { label: "Risk report", path: result.riskReportPath },
          { label: "Weekly system report", path: result.weeklyReportPath },
          { label: "Improvement proposals", path: result.governanceSummary?.improvementReportPath ?? path.join(primaryOutputPath, "reports", "improvement_proposals.md") }
        ];
      }
    }

    if (route.workflow === "security-audit") {
      const result = await this.securityAudit(primaryTargetPath, primaryOutputPath, route.trigger);
      const severityCounts = result.findings.reduce<Record<string, number>>((accumulator, finding) => {
        accumulator[finding.severity] = (accumulator[finding.severity] ?? 0) + 1;
        return accumulator;
      }, {});
      headline = result.headline;
      summary = [
        scopeNote ?? `Target path: ${primaryTargetPath}`,
        `Verdict: ${result.verdict}`,
        `Findings: critical=${severityCounts.critical ?? 0}, high=${severityCounts.high ?? 0}, medium=${severityCounts.medium ?? 0}, low=${severityCounts.low ?? 0}, info=${severityCounts.info ?? 0}`,
        `Context gaps: ${result.verifiedContext.contextGaps.slice(0, 3).join(" | ") || "None"}`
      ].filter(Boolean);
      artifacts = [
        { label: "Security audit report", path: result.reportPath },
        { label: "Security audit memory", path: result.memoryPath },
        ...(result.contextLiteReportPath ? [{ label: "Context-lite report", path: result.contextLiteReportPath }] : [])
      ];
    }

    if (route.workflow === "review-latest-changes") {
      const result = await this.reviewDelta(primaryTargetPath, primaryOutputPath, {
        baseRef: "HEAD~1",
        headRef: "HEAD"
      });
      headline = `Built a bounded review set for the latest repository changes.`;
      summary = [
        scopeNote ?? `Target path: ${primaryTargetPath}`,
        `Changed files: ${result.changedFiles.join(", ") || "None"}`,
        `Review set size: ${result.reviewFiles.length}`,
        `Related tests: ${result.impactedTests.join(", ") || "None"}`
      ].filter(Boolean);
      artifacts = [
        { label: "Impact report", path: result.reportPath },
        { label: "Code graph", path: result.graphPath }
      ];
    }

    if (route.workflow === "inspect-firewall") {
      const result = await this.inspectFirewall(primaryTargetPath, primaryOutputPath, route.trigger);
      headline = `Inspected the current agent policy and approval model.`;
      summary = [
        scopeNote ?? `Target path: ${primaryTargetPath}`,
        `Allowed tasks: ${result.firewall.stats.allowed}`,
        `Review-required tasks: ${result.firewall.stats.reviewRequired}`,
        `Blocked tasks: ${result.firewall.stats.blocked}`
      ].filter(Boolean);
      artifacts = [
        { label: "Firewall report", path: result.firewall.reportPath },
        { label: "Firewall policy JSON", path: result.firewall.policyPath },
        { label: "Task packet directory", path: result.firewall.packetDir }
      ];
    }

    if (route.workflow === "build-code-graph") {
      const result = await this.buildCodeGraph(primaryTargetPath, primaryOutputPath);
      headline = `Built or refreshed the structural code graph and factual repository graph.`;
      summary = [
        scopeNote ?? `Target path: ${primaryTargetPath}`,
        `Build mode: ${result.graph.build.mode}`,
        `Files: ${result.graph.stats.files}`,
        `Symbols: ${result.graph.stats.symbols}`,
        `Edges: ${result.graph.stats.edges}`,
        result.factGraph ? `Fact graph nodes: ${result.factGraph.stats.nodes}` : undefined,
        result.factGraph ? `Fact graph edges: ${result.factGraph.stats.edges}` : undefined
      ].filter((entry): entry is string => Boolean(entry));
      artifacts = [
        { label: "Code graph", path: result.graphPath },
        ...(result.factGraphPath ? [{ label: "Repository fact graph", path: result.factGraphPath }] : []),
        ...(result.factReportPath ? [{ label: "Repository fact graph report", path: result.factReportPath }] : [])
      ];
    }

    if (aiEnhancement) {
      headline = aiEnhancement.headline ?? headline;
      summary = mergeUniqueStrings(summary, aiEnhancement.summary);
      route.followUps = mergeUniqueStrings(route.followUps, aiEnhancement.followUps).slice(0, 6);
    }

    await ensureDir(path.dirname(briefPath));
    await writeFileEnsured(
      briefPath,
      `# Ask Brief

## Request

- Intent: ${intent}
- Workflow: ${route.workflow}
- Scope mode: ${scope.mode}
- Routing reason: ${route.reason}

## Headline

${headline}

## Summary

${renderList(summary)}

## Artifacts

${renderArtifactList(artifacts)}

## Preflight Facts

- Confidence: ${preflight.confidence}
- Facts found: ${preflight.factsFound ? "yes" : "no"}
- Recommended next action: ${preflight.recommendedNextAction}
- Fresh scopes: ${preflight.freshness.freshScopes.join(", ") || "None"}
- Stale scopes ignored: ${preflight.freshness.staleScopes.join(", ") || "None"}

Facts:
${renderList(preflight.facts)}

Evidence:
${renderList(preflight.evidence)}

Unknowns:
${renderList(preflight.unknowns)}

## Guided continuation

${guidedExecution
  ? renderList([
      `Step: ${guidedExecution.label}`,
      `Command: ${guidedExecution.command}`,
      `Headline: ${guidedExecution.headline}`,
      ...guidedExecution.summary
    ])
  : "- Not used"}

## AI Assist

${aiEnhancement
  ? renderList([
      `Model: ${aiEnhancement.modelSelection.model}`,
      `Provider: ${aiEnhancement.modelSelection.provider}`,
      `Profile: ${aiEnhancement.modelSelection.profile}`,
      `Residency: ${aiEnhancement.modelSelection.residency}`,
      ...(aiEnhancement.suggestedWorkflow ? [`Suggested workflow: ${aiEnhancement.suggestedWorkflow}`] : [])
    ])
  : "- Not used"}

## Suggested next prompts

${renderList(route.followUps)}
`
    );

    return {
      intent,
      workflow: route.workflow,
      targetPath,
      outputPath,
      scopeMode: scope.mode === "workspace" ? "workspace" : "repository",
      briefPath,
      headline,
      summary,
      artifacts,
      followUps: route.followUps,
      routingReason: route.reason,
      preflightFacts: preflight,
      guidedExecution: guidedExecution
        ? {
            label: guidedExecution.label,
            command: guidedExecution.command,
            headline: guidedExecution.headline,
            summary: guidedExecution.summary,
            artifacts: guidedExecution.artifacts
          }
        : undefined,
      aiAssistance: aiEnhancement
        ? {
            provider: aiEnhancement.modelSelection.provider,
            model: aiEnhancement.modelSelection.model,
            profile: aiEnhancement.modelSelection.profile,
            residency: aiEnhancement.modelSelection.residency,
            summary: aiEnhancement.summary,
            suggestedWorkflow: aiEnhancement.suggestedWorkflow
          }
        : undefined
    };
  }

  async swarm(
    targetPath: string,
    outputPath = targetPath,
    intent: string,
    options?: {
      engine?: "bounded" | "deepagents";
      parallelism?: number;
      chunkSize?: number;
      taskTimeoutMs?: number;
      maxRetries?: number;
      plannerTimeoutMs?: number;
      synthesisTimeoutMs?: number;
      runTimeoutMs?: number;
      maxQueuedTasks?: number;
      scopeBias?: "balanced" | "source-first";
    }
  ): Promise<SwarmRunResult> {
    const context = await this.initTarget(targetPath, outputPath);
    await writeMemoryBriefArtifacts(context);
    const memoryReadiness = await assessMemoryReadiness(context);
    if (memoryReadiness.status !== "ready") {
      throw new Error(`MEMORY_BRIEF is not ready (${memoryReadiness.status}): ${memoryReadiness.reason}`);
    }
    let result: SwarmRunResult;
    if (options?.engine === "deepagents") {
      result = await runDeepAgentsSwarm(context, intent, this.aiRouter, options);
    } else {
      result = await runSwarm(context, intent, this.aiRouter, options);
    }
    await recordSwarmLearningArtifacts(context.memoryDir, result);
    await writeMemoryBriefArtifacts(context);
    return result;
  }

  async selfImprove(
    targetPath: string,
    outputPath = targetPath,
    intent = "ayudame a mejorar este repo y prioriza mejoras reales"
  ): Promise<SwarmRunResult> {
    return this.swarm(targetPath, outputPath, intent, {
      chunkSize: 1,
      taskTimeoutMs: 12_000,
      plannerTimeoutMs: 8_000,
      synthesisTimeoutMs: 8_000,
      runTimeoutMs: 45_000,
      maxRetries: 1,
      scopeBias: "source-first"
    });
  }

  async architecturePlan(targetPath: string, outputPath = targetPath): Promise<ArchitecturePlanResult> {
    const scope = await discoverRepositoryTargets(targetPath, outputPath);
    const firstRepository = scope.repositories[0];
    const primaryTargetPath = firstRepository?.targetPath ?? targetPath;
    const primaryOutputPath =
      scope.mode === "workspace" && firstRepository
        ? this.workspaceRepoOutputPath(outputPath, firstRepository)
        : outputPath;
    const context = await this.initTarget(primaryTargetPath, primaryOutputPath);
    const result = await writeArchitecturePlanArtifacts(context);
    await writeMemoryBriefArtifacts(context);
    return result;
  }

  async scaffoldProject(targetPath: string, input: ProjectSeedInput): Promise<ProjectSeedResult> {
    return writeProjectSeedArtifacts(path.resolve(targetPath), input);
  }

  async planImprovements(
    targetPath: string,
    outputPath = targetPath,
    trigger: GovernanceTrigger = "manual"
  ): Promise<ImprovementPlanResult> {
    const scope = await discoverRepositoryTargets(targetPath, outputPath);
    const firstRepository = scope.repositories[0];
    const primaryTargetPath = firstRepository?.targetPath ?? targetPath;
    const primaryOutputPath =
      scope.mode === "workspace" && firstRepository
        ? this.workspaceRepoOutputPath(outputPath, firstRepository)
        : outputPath;
    const analysis = await this.analyzeTarget(primaryTargetPath, primaryOutputPath, trigger);
    const annotations = await listContextAnnotations(primaryOutputPath);

    const result = await writeImprovementPlanArtifacts(
      analysis.context,
      analysis.agentReports,
      analysis.governanceSummary!,
      annotations
    );
    await writeMemoryBriefArtifacts(analysis.context);
    return result;
  }

  async contextSearch(
    targetPath: string,
    outputPath = targetPath,
    query = "",
    trust?: "official" | "maintainer" | "community"
  ): Promise<ContextSearchResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return searchContextRegistry(context, query, trust);
  }

  async contextGet(targetPath: string, outputPath = targetPath, id = ""): Promise<ContextGetResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return getContextRegistryEntry(context, id);
  }

  async contextSources(targetPath: string, outputPath = targetPath): Promise<ContextSourcesResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return listContextSources(context);
  }

  async ecosystemRadar(
    targetPath: string,
    outputPath = targetPath,
    options: {
      limit?: number;
      bucketId?: string;
      seedOnly?: boolean;
    } = {}
  ): Promise<EcosystemRadarResult> {
    const context = await this.initTarget(targetPath, outputPath);
    return runEcosystemRadar(context, options);
  }

  async analyzeTarget(
    targetPath: string,
    outputPath = targetPath,
    trigger: GovernanceTrigger = "manual"
  ): Promise<OrchestrationResult> {
    const cycleId = createCycleId(trigger);
    const span = this.metricsCollector.startCycle(trigger, cycleId);

    return withLogContext({ cycleId }, async () => {
      this.logger.info("Cycle started", {
        action: "cycle_start",
        cycleType: trigger,
        targetPath,
        outputPath
      });

      const discovery = await this.discoveryEngine.analyze(targetPath, {
        excludePaths: this.discoveryExclusions(targetPath, outputPath)
      });
      const context = await this.contextBuilder.build(discovery, outputPath);
      const governanceRun = await this.selfGovernance.run(context, trigger);
      const agentReports = governanceRun.agentReports;
      const reportAssessments = await Promise.all(agentReports.map((report) => assessAgentReportQuality(context, report)));
      const acceptedReports = reportAssessments
        .filter((assessment) => assessment.status === "accepted")
        .map((assessment) => assessment.report);
      const effectiveReports = acceptedReports.length > 0 ? acceptedReports : agentReports;
      const fellBackToRawReports = acceptedReports.length === 0 && agentReports.length > 0;
      const reportQualityPath = path.join(context.reportsDir, "report_quality.md");

      await writeFileEnsured(
        reportQualityPath,
        buildReportQualityContent(context, reportAssessments, effectiveReports, fellBackToRawReports)
      );

      for (const record of governanceRun.summary.executionRecords) {
        this.logger.info("Agent execution observed", {
          agent: record.agentId,
          action:
            record.status === "completed"
              ? "agent_complete"
              : record.status === "failed"
                ? "agent_failed"
                : "agent_start",
          taskId: record.taskId,
          startedAt: record.startedAt,
          completedAt: record.completedAt ?? null,
          status: record.status
        });
      }

      for (const assessment of reportAssessments.filter((entry) => entry.status === "review-required")) {
        this.logger.warn("Agent report marked for manual review", {
          action: "report_quality_review_required",
          agent: assessment.report.agentId,
          score: assessment.score,
          notes: assessment.notes,
          reportPath: assessment.report.outputPath
        });
      }

      await updatePersistentMemory(context, effectiveReports);
      await recordLearningArtifacts(context.memoryDir, effectiveReports);
      await writeMemoryBriefArtifacts(context);

      if (governanceRun.summary.proposals.length > 0) {
        this.logger.info("Improvement proposals generated", {
          action: "proposal_generated",
          proposalsGenerated: governanceRun.summary.proposals.length,
          approved: governanceRun.summary.proposals.filter((proposal) => proposal.status === "APPROVED").length,
          review: governanceRun.summary.proposals.filter((proposal) => proposal.status === "REQUIRES_HUMAN_REVIEW").length,
          rejected: governanceRun.summary.proposals.filter((proposal) => proposal.status === "REJECTED").length
        });
      }

      const weeklyReportPath = await this.writeWeeklySystemReport(context, effectiveReports);
      this.logger.info("Weekly report generated", {
        action: "report_generated",
        report: "weekly_system_report",
        reportPath: weeklyReportPath
      });
      const riskReportPath = await this.writeRiskReport(context, effectiveReports);
      this.logger.info("Risk report generated", {
        action: "report_generated",
        report: "risk_report",
        reportPath: riskReportPath
      });

      const telemetry = this.metricsCollector.completeCycle(span, context.repoName, effectiveReports, governanceRun.summary);
      const telemetryPath = await this.metricsCollector.persistCycleTelemetry(context, telemetry);
      const runtimeObservabilityPath = await this.metricsCollector.writeRuntimeObservabilityReport(context.reportsDir);

      this.logger.info("Runtime observability updated", {
        action: "report_generated",
        report: "runtime_observability",
        reportPath: runtimeObservabilityPath,
        telemetryPath
      });

      this.logger.info("Cycle completed", {
        action: "cycle_complete",
        repoName: context.repoName,
        outputPath,
        highestRisk: highestRisk(effectiveReports),
        cycleDuration: telemetry.cycleDuration,
        agentsExecuted: telemetry.agentsExecuted,
        risksDetected: telemetry.risksDetected
      });

      return {
        context,
        agentReports,
        weeklyReportPath,
        riskReportPath,
        reportQualityPath,
        governanceSummary: governanceRun.summary
      };
    });
  }

  async runAgents(
    targetPath: string,
    outputPath = targetPath,
    trigger: GovernanceTrigger = "manual"
  ): Promise<AgentReport[]> {
    const result = await this.analyzeTarget(targetPath, outputPath, trigger);
    return result.agentReports;
  }

  async generateWeekly(targetPath: string, outputPath = targetPath): Promise<OrchestrationResult> {
    return this.analyzeTarget(targetPath, outputPath, "weekly-review");
  }

  async analyzeScope(
    targetPath: string,
    outputPath = targetPath,
    trigger: GovernanceTrigger = "manual"
  ): Promise<OrchestrationResult | EcosystemAnalysisResult> {
    const scope = await discoverRepositoryTargets(targetPath, outputPath);

    if (scope.mode === "workspace") {
      return this.analyzeWorkspace(targetPath, outputPath, trigger, scope.repositories);
    }

    return this.analyzeTarget(scope.repositories[0]?.targetPath ?? targetPath, outputPath, trigger);
  }

  async mapScope(targetPath: string, outputPath = targetPath): Promise<CodebaseMapResult | EcosystemCodebaseMapResult> {
    const scope = await discoverRepositoryTargets(targetPath, outputPath);

    if (scope.mode === "workspace") {
      return this.mapWorkspace(targetPath, outputPath, scope.repositories);
    }

    return this.mapTarget(scope.repositories[0]?.targetPath ?? targetPath, outputPath);
  }

  async generateWeeklyScope(targetPath: string, outputPath = targetPath): Promise<OrchestrationResult | EcosystemAnalysisResult> {
    return this.analyzeScope(targetPath, outputPath, "weekly-review");
  }

  async recordFeedback(
    targetPath: string,
    outputPath: string,
    input: Parameters<AgentSelfGovernanceSystem["recordFeedback"]>[1]
  ) {
    const discovery = await this.discoveryEngine.analyze(targetPath, {
      excludePaths: this.discoveryExclusions(targetPath, outputPath)
    });
    const context = await this.contextBuilder.build(discovery, outputPath);
    return this.selfGovernance.recordFeedback(context, input);
  }

  async annotateTarget(
    targetPath: string,
    outputPath: string,
    input: {
      scope: string;
      note: string;
    }
  ): Promise<ContextAnnotation> {
    await this.initTarget(targetPath, outputPath);
    return writeContextAnnotation(outputPath, input.scope, input.note);
  }

  async readAnnotation(targetPath: string, outputPath: string, scope: string): Promise<ContextAnnotation | undefined> {
    await this.initTarget(targetPath, outputPath);
    return readContextAnnotation(outputPath, scope);
  }

  async listAnnotations(targetPath: string, outputPath: string): Promise<ContextAnnotation[]> {
    await this.initTarget(targetPath, outputPath);
    return listContextAnnotations(outputPath);
  }

  async clearAnnotation(targetPath: string, outputPath: string, scope: string): Promise<boolean> {
    await this.initTarget(targetPath, outputPath);
    return clearContextAnnotation(outputPath, scope);
  }

  async collectReportManifest(outputPath: string): Promise<ReportManifest> {
    const files = await walkDirectory(outputPath, 8000, [], { includeGeneratedArtifacts: true });
    return {
      memoryFiles: files.filter((file) => file.startsWith("AI_CONTEXT/")),
      reportFiles: files.filter((file) => file.startsWith("reports/")),
      docFiles: files.filter((file) => file.startsWith("docs/")),
      learningFiles: files.filter((file) => file.startsWith("memory/learnings/")),
      swarmFiles: files.filter((file) => file.startsWith("memory/swarm/") || file === "reports/swarm_run.md"),
      firewallFiles: files.filter((file) => file.startsWith("memory/firewall/")),
      securityFiles: files.filter((file) => file.startsWith("memory/security/") || file === "reports/security_audit.md"),
      knowledgeFiles: files.filter((file) => file.startsWith("memory/knowledge_graph/")),
      contextRegistryFiles: files.filter((file) => file.startsWith("memory/context_registry/") || file.startsWith("AI_CONTEXT/EXTERNAL_CONTEXT/")),
      taskFiles: files.filter((file) => file.startsWith("tasks/")),
      patchProposalFiles: files.filter((file) => file.startsWith("patch_proposals/")),
      proposalFiles: files.filter(
        (file) => file.startsWith("docs/proposals/") || file.startsWith("proposal/")
      )
    };
  }

  private workspaceRepoOutputPath(outputPath: string, repository: RepositoryTarget): string {
    const slug = repository.relativePath
      .replace(/[^a-zA-Z0-9/_-]+/g, "_")
      .replace(/\//g, "_")
      .replace(/^_+|_+$/g, "");

    return path.join(outputPath, "ecosystem", slug || repository.repoName);
  }

  private async readRepositoryTelemetry(
    repository: EcosystemRepositoryResult
  ): Promise<Parameters<MetricsCollector["persistTelemetry"]>[1] | undefined> {
    const telemetryFiles = await walkDirectory(path.join(repository.outputPath, "reports", "telemetry"));
    const latestFile = telemetryFiles
      .filter((file) => file.startsWith("cycle_") && file.endsWith(".json"))
      .sort((left, right) => right.localeCompare(left))[0];

    if (!latestFile) {
      return undefined;
    }

    return readJsonSafe(path.join(repository.outputPath, "reports", "telemetry", latestFile));
  }

  private async analyzeWorkspace(
    rootPath: string,
    outputPath: string,
    trigger: GovernanceTrigger,
    repositories: RepositoryTarget[]
  ): Promise<EcosystemAnalysisResult> {
    const cycleId = createCycleId(`ecosystem_${trigger}`);
    const span = this.metricsCollector.startCycle(trigger, cycleId);

    await ensureDir(outputPath);

    return withLogContext({ cycleId }, async () => {
      this.logger.info("Workspace analysis started", {
        component: "orchestrator",
        action: "cycle_start",
        cycleType: trigger,
        targetPath: rootPath,
        outputPath,
        repositories: uniqueRepositoryNames(repositories)
      });

      const ecosystemResults = await Promise.all(
        repositories.map(async (repository) => {
          const repositoryOutputPath = this.workspaceRepoOutputPath(outputPath, repository);
          const result = await this.analyzeTarget(repository.targetPath, repositoryOutputPath, trigger);
          return {
            repoName: repository.repoName,
            relativePath: repository.relativePath,
            targetPath: repository.targetPath,
            outputPath: repositoryOutputPath,
            result
          } satisfies EcosystemRepositoryResult;
        })
      );

      const { knowledgeGraphPath, proposalPaths, ecosystemReportPath } = await buildKnowledgeGraphArtifacts(
        outputPath,
        ecosystemResults
      );
      const rootReportsDir = path.join(outputPath, "reports");
      const repositoryTelemetries = (
        await Promise.all(ecosystemResults.map((repository) => this.readRepositoryTelemetry(repository)))
      ).filter(Boolean) as Array<Parameters<MetricsCollector["persistTelemetry"]>[1]>;

      await Promise.all(
        repositoryTelemetries.map((telemetry) => this.metricsCollector.persistTelemetry(rootReportsDir, telemetry))
      );
      const ecosystemTelemetry = this.metricsCollector.completeCycle(
        span,
        "ecosystem",
        ecosystemResults.flatMap((repository) => repository.result.agentReports),
        {
          trigger,
          tasks: ecosystemResults.flatMap((repository) => repository.result.governanceSummary?.tasks ?? []),
          messages: ecosystemResults.flatMap((repository) => repository.result.governanceSummary?.messages ?? []),
          evaluations: ecosystemResults.flatMap((repository) => repository.result.governanceSummary?.evaluations ?? []),
          learnings: ecosystemResults.flatMap((repository) => repository.result.governanceSummary?.learnings ?? []),
          proposals: ecosystemResults.flatMap((repository) => repository.result.governanceSummary?.proposals ?? []),
          executionRecords: ecosystemResults.flatMap(
            (repository) => repository.result.governanceSummary?.executionRecords ?? []
          ),
          agentActivityReportPath: ecosystemResults.map((repository) => repository.result.governanceSummary?.agentActivityReportPath).filter(Boolean).join(", "),
          improvementReportPath: ecosystemResults.map((repository) => repository.result.governanceSummary?.improvementReportPath).filter(Boolean).join(", ")
        }
      );
      const telemetryPath = await this.metricsCollector.persistTelemetry(rootReportsDir, {
        ...ecosystemTelemetry,
        agentIds: ecosystemResults.flatMap((repository) =>
          repository.result.governanceSummary?.tasks.map((task) => `${repository.repoName}:${task.agentId}`) ?? []
        ),
        riskTypes: ecosystemResults.flatMap((repository) =>
          repository.result.agentReports
            .filter((report) => report.findings.length > 0)
            .map((report) => `${repository.repoName}:${report.riskLevel}`)
        )
      });
      const runtimeObservabilityPath = await this.metricsCollector.writeRuntimeObservabilityReport(rootReportsDir);

      this.logger.info("Workspace analysis completed", {
        component: "orchestrator",
        action: "cycle_complete",
        cycleType: trigger,
        cycleId,
        repositories: ecosystemResults.map((repository) => repository.repoName),
        knowledgeGraphPath,
        ecosystemReportPath,
        telemetryPath
      });

      return {
        rootPath,
        outputPath,
        trigger,
        repositories: ecosystemResults,
        knowledgeGraphPath,
        ecosystemReportPath,
        telemetryPath,
        runtimeObservabilityPath,
        proposalPaths
      };
    });
  }

  private async mapWorkspace(
    rootPath: string,
    outputPath: string,
    repositories: RepositoryTarget[]
  ): Promise<EcosystemCodebaseMapResult> {
    await ensureDir(outputPath);

    const results = await Promise.all(
      repositories.map(async (repository) => {
        const repositoryOutputPath = this.workspaceRepoOutputPath(outputPath, repository);
        const result = await this.mapTarget(repository.targetPath, repositoryOutputPath);

        return {
          repoName: repository.repoName,
          relativePath: repository.relativePath,
          targetPath: repository.targetPath,
          outputPath: repositoryOutputPath,
          codebaseMapDir: result.codebaseMapDir,
          files: result.files,
          summaryPath: result.summaryPath
        };
      })
    );

    const summaryPath = await this.writeWorkspaceCodebaseMapSummary(rootPath, outputPath, results);

    return {
      rootPath,
      outputPath,
      repositories: results,
      summaryPath
    };
  }

  private async writeWorkspaceCodebaseMapSummary(
    rootPath: string,
    outputPath: string,
    repositories: EcosystemCodebaseMapResult["repositories"]
  ): Promise<string> {
    const summaryPath = path.join(outputPath, "docs", "ecosystem_codebase_map.md");
    const content = `# Ecosystem Codebase Map

- Root path: ${rootPath}
- Repositories mapped: ${repositories.length}
- Repository names: ${uniqueRepositoryNames(repositories).join(", ") || "None"}

## Repository outputs

${renderList(
  repositories.map(
    (repository) =>
      `${repository.repoName} | relative path: ${repository.relativePath} | codebase map: ${repository.codebaseMapDir}`
  )
)}
`;

    await writeFileEnsured(summaryPath, content);
    return summaryPath;
  }

  private async writeWeeklySystemReport(context: ProjectContext, agentReports: AgentReport[]): Promise<string> {
    const schedule = this.scheduler.describeWindow(new Date(context.scannedAt));
    const outputPath = path.join(context.reportsDir, "weekly_system_report.md");
    const content = `# Weekly System Report

## Executive Summary

- Repository: ${context.repoName}
- Window: ${schedule.label}
- Overall risk: ${highestRisk(agentReports)}
- Next suggested run: ${schedule.nextRun}

## Agent summaries

${agentReports.map((report) => `### ${report.title}\n\n- Risk: ${report.riskLevel}\n- Summary: ${report.summary}`).join("\n\n")}

## Recommended actions

${renderList(agentReports.flatMap((report) => report.recommendations))}
`;
    await writeFileEnsured(outputPath, content);
    return outputPath;
  }

  private async writeRiskReport(context: ProjectContext, agentReports: AgentReport[]): Promise<string> {
    const outputPath = path.join(context.reportsDir, "risk_report.md");
    const prioritizedFindings = agentReports
      .filter((report) => report.findings.length > 0)
      .sort((left, right) => {
        const priority = { high: 3, medium: 2, low: 1 };
        return priority[right.riskLevel] - priority[left.riskLevel];
      })
      .flatMap((report) => report.findings.map((finding) => `[${report.title}] ${finding}`));

    const content = `# Risk Report

## Highest Risks

${renderList(prioritizedFindings)}

## Follow-up

${renderList(agentReports.flatMap((report) => report.recommendations))}
`;
    await writeFileEnsured(outputPath, content);
    return outputPath;
  }
}
