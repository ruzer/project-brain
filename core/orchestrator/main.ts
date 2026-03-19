import path from "node:path";

import { buildOrUpdateCodeGraphV2 } from "../../analysis/code_graph_v2";
import { analyzeImpactRadius } from "../../analysis/impact_radius";
import { MetricsCollector } from "../../analysis/metrics/metrics_collector";
import { discoverRepositoryTargets, uniqueRepositoryNames } from "../../analysis/workspace_discovery";
import { AIRouter, type AIRouterRequest, type ModelInventory, type ModelSelection } from "../ai_router/router";
import { routeIntent } from "../intent_router";
import { writeCodebaseMapArtifacts } from "../codebase_map";
import { runDoctor } from "../doctor";
import { buildResume } from "../resume";
import { buildStatus } from "../status";
import { ContextBuilder } from "../context_builder";
import { WeeklyScheduler } from "../scheduler";
import { DiscoveryEngine } from "../discovery_engine";
import { runSwarm } from "../swarm_runtime";
import { AgentSelfGovernanceSystem } from "../../governance/self-governance-system";
import { buildKnowledgeGraphArtifacts } from "../../memory/knowledge_graph";
import { recordLearningArtifacts } from "../../memory/learning_store";
import { clearContextAnnotation, listContextAnnotations, readContextAnnotation, writeContextAnnotation } from "../../memory/annotations";
import { getContextRegistryEntry, listContextSources, searchContextRegistry } from "../../memory/context_registry";
import { updatePersistentMemory } from "../../memory/context_store";
import { writeImprovementPlanArtifacts } from "../../planning/improvement_plan";
import { createCycleId, StructuredLogger, withLogContext } from "../../shared/logger";
import { ensureDir, readJsonSafe, toPosixPath, walkDirectory, writeFileEnsured } from "../../shared/fs-utils";
import type {
  AgentReport,
  AskArtifact,
  AskResult,
  AskWorkflow,
  CodeGraphBuildResult,
  CodebaseMapResult,
  ContextGetResult,
  ContextAnnotation,
  ContextSearchResult,
  ContextSourcesResult,
  ImpactAnalysisResult,
  EcosystemCodebaseMapResult,
  EcosystemAnalysisResult,
  EcosystemRepositoryResult,
  FirewallInspectionResult,
  GovernanceTrigger,
  ImprovementPlanResult,
  OrchestrationResult,
  ProjectContext,
  ReportManifest,
  RepositoryTarget,
  DoctorResult,
  ResumeResult,
  StatusResult,
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
    "critical-gaps",
    "review-latest-changes",
    "inspect-firewall",
    "build-code-graph"
  ];

  return allowed.includes(value as AskWorkflow) ? (value as AskWorkflow) : undefined;
}

function shouldUseAIAskAssist(intent: string, workflow: AskWorkflow): boolean {
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
    return this.contextBuilder.build(discovery, outputPath);
  }

  async mapTarget(targetPath: string, outputPath = targetPath): Promise<CodebaseMapResult> {
    const context = await this.initTarget(targetPath, outputPath);
    const artifact = await writeCodebaseMapArtifacts(context);

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
    return buildOrUpdateCodeGraphV2(context);
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
      headline = `Built or refreshed the structural code graph.`;
      summary = [
        scopeNote ?? `Target path: ${primaryTargetPath}`,
        `Build mode: ${result.graph.build.mode}`,
        `Files: ${result.graph.stats.files}`,
        `Symbols: ${result.graph.stats.symbols}`,
        `Edges: ${result.graph.stats.edges}`
      ].filter(Boolean);
      artifacts = [{ label: "Code graph", path: result.graphPath }];
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
    return runSwarm(context, intent, this.aiRouter, options);
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

    return writeImprovementPlanArtifacts(
      analysis.context,
      analysis.agentReports,
      analysis.governanceSummary!,
      annotations
    );
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

      await updatePersistentMemory(context, agentReports);
      await recordLearningArtifacts(context.memoryDir, agentReports);

      if (governanceRun.summary.proposals.length > 0) {
        this.logger.info("Improvement proposals generated", {
          action: "proposal_generated",
          proposalsGenerated: governanceRun.summary.proposals.length,
          approved: governanceRun.summary.proposals.filter((proposal) => proposal.status === "APPROVED").length,
          review: governanceRun.summary.proposals.filter((proposal) => proposal.status === "REQUIRES_HUMAN_REVIEW").length,
          rejected: governanceRun.summary.proposals.filter((proposal) => proposal.status === "REJECTED").length
        });
      }

      const weeklyReportPath = await this.writeWeeklySystemReport(context, agentReports);
      this.logger.info("Weekly report generated", {
        action: "report_generated",
        report: "weekly_system_report",
        reportPath: weeklyReportPath
      });
      const riskReportPath = await this.writeRiskReport(context, agentReports);
      this.logger.info("Risk report generated", {
        action: "report_generated",
        report: "risk_report",
        reportPath: riskReportPath
      });

      const telemetry = this.metricsCollector.completeCycle(span, context.repoName, agentReports, governanceRun.summary);
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
        highestRisk: highestRisk(agentReports),
        cycleDuration: telemetry.cycleDuration,
        agentsExecuted: telemetry.agentsExecuted,
        risksDetected: telemetry.risksDetected
      });

      return {
        context,
        agentReports,
        weeklyReportPath,
        riskReportPath,
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
    const files = await walkDirectory(outputPath);
    return {
      memoryFiles: files.filter((file) => file.startsWith("AI_CONTEXT/")),
      reportFiles: files.filter((file) => file.startsWith("reports/")),
      docFiles: files.filter((file) => file.startsWith("docs/")),
      learningFiles: files.filter((file) => file.startsWith("memory/learnings/")),
      swarmFiles: files.filter((file) => file.startsWith("memory/swarm/") || file === "reports/swarm_run.md"),
      firewallFiles: files.filter((file) => file.startsWith("memory/firewall/")),
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
