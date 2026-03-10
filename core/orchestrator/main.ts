import path from "node:path";

import { MetricsCollector } from "../../analysis/metrics/metrics_collector";
import { discoverRepositoryTargets, uniqueRepositoryNames } from "../../analysis/workspace_discovery";
import { ContextBuilder } from "../context_builder";
import { WeeklyScheduler } from "../scheduler";
import { DiscoveryEngine } from "../discovery_engine";
import { AgentSelfGovernanceSystem } from "../../governance/self-governance-system";
import { buildKnowledgeGraphArtifacts } from "../../memory/knowledge_graph";
import { recordLearningArtifacts } from "../../memory/learning_store";
import { updatePersistentMemory } from "../../memory/context_store";
import { createCycleId, StructuredLogger, withLogContext } from "../../shared/logger";
import { ensureDir, readJsonSafe, toPosixPath, walkDirectory, writeFileEnsured } from "../../shared/fs-utils";
import type {
  AgentReport,
  EcosystemAnalysisResult,
  EcosystemRepositoryResult,
  GovernanceTrigger,
  OrchestrationResult,
  ProjectContext,
  ReportManifest,
  RepositoryTarget
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

export class ProjectBrainOrchestrator {
  private readonly logger = new StructuredLogger("orchestrator");
  private readonly discoveryEngine = new DiscoveryEngine();
  private readonly contextBuilder = new ContextBuilder();
  private readonly selfGovernance = new AgentSelfGovernanceSystem();
  private readonly scheduler = new WeeklyScheduler();
  private readonly metricsCollector = new MetricsCollector();

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

  async collectReportManifest(outputPath: string): Promise<ReportManifest> {
    const files = await walkDirectory(outputPath);
    return {
      memoryFiles: files.filter((file) => file.startsWith("AI_CONTEXT/")),
      reportFiles: files.filter((file) => file.startsWith("reports/")),
      docFiles: files.filter((file) => file.startsWith("docs/")),
      learningFiles: files.filter((file) => file.startsWith("memory/learnings/")),
      knowledgeFiles: files.filter((file) => file.startsWith("memory/knowledge_graph/")),
      taskFiles: files.filter((file) => file.startsWith("tasks/")),
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
