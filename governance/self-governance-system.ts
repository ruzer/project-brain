import { promises as fs } from "node:fs";
import path from "node:path";

import { buildAgentCatalog } from "../agents/catalog";
import { AgentCouncil } from "./agent-council";
import { AgentEvaluator } from "./agent-evaluator";
import { AgentMessageCenter } from "./message-center";
import { AgentRegistry } from "./agent-registry";
import { AgentSupervisor, GOVERNANCE_RULES } from "./agent-supervisor";
import { AgentTaskBoard } from "./task-board";
import { AutonomousScheduler } from "./autonomous-scheduler";
import { AgentLearningStore } from "../memory/learnings";
import { StructuredLogger } from "../shared/logger";
import { readTextSafe, writeFileEnsured } from "../shared/fs-utils";
import type {
  AgentEvaluationScore,
  AgentReport,
  GovernanceSummary,
  GovernanceTrigger,
  LearningRecord,
  ProjectContext,
  ProposalArtifact
} from "../shared/types";

function sortByScore(scores: AgentEvaluationScore[]): AgentEvaluationScore[] {
  return [...scores].sort((left, right) => right.overallScore - left.overallScore);
}

function createProposalId(agentId: string, index: number): string {
  return `proposal_${agentId}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function proposalFileName(agentId: string, index: number, title: string): string {
  return `proposal_${String(index).padStart(2, "0")}_${agentId.replace(/-/g, "_")}_${slugify(title)}.md`;
}

function renderGovernanceRules(): string {
  return GOVERNANCE_RULES.map((rule) => `- ${rule}`).join("\n");
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function sanitizeArtifactPath(filePath: string): boolean {
  return !filePath.startsWith("tests/fixtures/") && !filePath.startsWith("sample-output/");
}

function defaultAffectedFiles(agentId: string, context: ProjectContext): string[] {
  const manifests = context.discovery.manifests.filter(sanitizeArtifactPath);
  const infraFiles = context.discovery.infraFiles.filter(sanitizeArtifactPath);
  const apiFiles = context.discovery.apiFiles.filter(sanitizeArtifactPath);

  if (agentId === "qa-agent") {
    return ["tests/", "package.json", ...manifests.slice(0, 2)];
  }
  if (agentId === "security-agent") {
    return [...manifests.slice(0, 2), ...infraFiles.slice(0, 2)];
  }
  if (agentId === "documentation-agent") {
    return ["docs/", ...apiFiles.slice(0, 2)];
  }
  if (agentId === "observability-agent") {
    return [...infraFiles.slice(0, 2), "integrations/logs/", "integrations/metrics/"];
  }
  if (agentId === "optimization-agent") {
    return [...manifests.slice(0, 2), ...infraFiles.slice(0, 2)];
  }
  if (agentId === "product-owner-agent") {
    return ["README.md", "docs/", "AI_CONTEXT/"];
  }
  if (agentId === "architecture-agent" || agentId === "dev-agent") {
    return context.discovery.structure.topLevelDirectories.slice(0, 4);
  }

  return context.discovery.structure.topLevelDirectories.slice(0, 3);
}

function extractAffectedFiles(markdown: string): string[] {
  const matches = [
    ...markdown.matchAll(/Affected files:\s*(.+)/gi),
    ...markdown.matchAll(/files:\s*([^)]+)\)/gi)
  ];

  return [...new Set(
    matches
      .flatMap((match) => (match[1] ?? "").split(/[,;]/))
      .map((value) => value.trim())
      .map((value) => value.replace(/\b(difficulty|confidence)\b.*$/i, "").trim())
      .filter((value) => Boolean(value) && sanitizeArtifactPath(value))
      .filter((value) => /\/|\.md$|\.json$|\.ya?ml$|\.ts$|\.js$/.test(value))
  )].sort((left, right) => left.localeCompare(right));
}

function expectedBenefitFor(agentId: string, riskLevel: AgentReport["riskLevel"]): string {
  const suffix =
    riskLevel === "high"
      ? " It reduces near-term operational and delivery risk."
      : riskLevel === "medium"
        ? " It improves reliability and maintainability."
        : " It keeps the system easier to evolve safely.";

  if (agentId === "qa-agent") {
    return `Increase regression protection and confidence in future autonomous proposals.${suffix}`;
  }
  if (agentId === "security-agent") {
    return `Reduce security exposure, dependency risk, and compliance surprises.${suffix}`;
  }
  if (agentId === "documentation-agent") {
    return `Improve discoverability, onboarding, and operational clarity.${suffix}`;
  }
  if (agentId === "dev-agent" || agentId === "architecture-agent") {
    return `Lower architectural drift and reduce the cost of future refactors.${suffix}`;
  }
  if (agentId === "observability-agent") {
    return `Improve diagnosability and shorten incident response time.${suffix}`;
  }
  if (agentId === "optimization-agent") {
    return `Reduce runtime and delivery friction while preserving system safety.${suffix}`;
  }
  if (agentId === "product-owner-agent") {
    return `Make engineering effort align better with user and operator value.${suffix}`;
  }

  return `Provide a safer, more actionable improvement backlog for the repository.${suffix}`;
}

function implementationSketchFor(recommendation: string, affectedFiles: string[]): string {
  return [
    `Validate the issue against the current repository state and the agent report.`,
    `Scope the change to: ${affectedFiles.join(", ") || "repository-wide surfaces"}.`,
    `Start with: ${recommendation.replace(/\s*\(files:[^)]+\)/i, "").trim()}.`,
    "Run build, tests, and smoke checks before any human approval decision."
  ].join(" ");
}

export class AgentSelfGovernanceSystem {
  private readonly logger = new StructuredLogger("agent-self-governance");
  private readonly registry = new AgentRegistry();
  private readonly council = new AgentCouncil();
  private readonly supervisor = new AgentSupervisor();
  private readonly evaluator = new AgentEvaluator();
  private readonly learningStore = new AgentLearningStore();

  constructor() {
    this.registry.registerAll(buildAgentCatalog());
  }

  async run(context: ProjectContext, trigger: GovernanceTrigger = "manual"): Promise<{
    agentReports: AgentReport[];
    summary: GovernanceSummary;
  }> {
    const scheduler = new AutonomousScheduler(this.registry);
    const taskBoard = new AgentTaskBoard(context.taskBoardDir);
    const messages = new AgentMessageCenter();
    const previousLearnings = await this.learningStore.loadAll(context.learningDir);
    const selectedAgents = scheduler.selectAgents(trigger);
    let tasks = this.council.planTasks(selectedAgents, trigger, previousLearnings);
    const agentReports: AgentReport[] = [];
    const evaluationScores: AgentEvaluationScore[] = [];

    await taskBoard.initialize();
    messages.seedTaskAssignments(tasks, trigger);
    await taskBoard.persist(tasks);

    for (const task of tasks) {
      const registered = this.registry.get(task.agentId);
      if (!registered) {
        continue;
      }

      tasks = taskBoard.claim(tasks, task.taskId);
      await taskBoard.persist(tasks);
      this.supervisor.start(task, registered.descriptor);

      try {
        const report = await registered.agent.run(context);
        agentReports.push(report);
        messages.recordAnalysisResult(task, report);
        messages.coordinateFollowUps(task, report);

        const requiresHumanApproval = this.supervisor.requiresHumanApproval(registered.descriptor, report);
        if (requiresHumanApproval) {
          this.logger.warn("Governance escalation required", {
            component: "governance",
            agent: registered.descriptor.agentId,
            action: "governance_escalation",
            taskId: task.taskId
          });
          messages.escalateToHuman(task, "Proposal touches a governed area and needs human approval.", "high");
        }

        const updatedTask = {
          ...task,
          state: "PROPOSED" as const,
          completedAt: new Date().toISOString(),
          reportPath: report.outputPath
        };
        tasks = taskBoard.update(tasks, updatedTask);
        this.supervisor.complete(task.taskId);

        evaluationScores.push(this.evaluator.evaluate(updatedTask, report));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.supervisor.fail(task.taskId, message);
        const failedTask = {
          ...task,
          state: "REJECTED" as const,
          completedAt: new Date().toISOString()
        };
        tasks = taskBoard.update(tasks, failedTask);
        messages.escalateToHuman(task, `Agent execution failed: ${message}`, "critical");
      }
    }

    const rankedScores = this.evaluator.rank(evaluationScores);
    const conflictMessages = this.council.resolveConflicts(tasks, agentReports);

    for (const conflict of conflictMessages) {
      const firstTask = tasks[0];
      if (firstTask) {
        messages.escalateToHuman(firstTask, conflict, "high");
      }
    }

    const proposals = await this.writeImprovementProposals(context, rankedScores, agentReports);
    tasks = this.applyProposalDecisions(tasks, proposals);
    const learnings = await this.deriveLearnings(context, tasks, rankedScores, agentReports, previousLearnings);
    const repeatedPatterns = this.learningStore.findRepeatedPatterns([...previousLearnings, ...learnings]);

    await this.learningStore.appendBatch(context.learningDir, learnings);
    await taskBoard.persist(tasks);
    await messages.persist(context.taskBoardDir);

    const agentActivityReportPath = await this.writeAgentActivityReport(
      context,
      trigger,
      tasks,
      rankedScores,
      previousLearnings,
      proposals,
      repeatedPatterns.map((pattern) => `${pattern.detectedProblem} (${pattern.count} cycles)`)
    );
    const improvementReportPath = await this.writeImprovementReport(
      context,
      rankedScores,
      agentReports,
      proposals,
      conflictMessages,
      repeatedPatterns.map((pattern) => `${pattern.detectedProblem} | agents=${pattern.agentIds.join(", ")} | count=${pattern.count}`)
    );

    this.logger.info("Self-governance cycle completed", {
      component: "governance",
      action: "cycle_complete",
      repoName: context.repoName,
      trigger,
      tasks: tasks.length,
      proposals: proposals.length
    });

    return {
      agentReports,
      summary: {
        trigger,
        tasks,
        messages: messages.list(),
        evaluations: rankedScores,
        learnings,
        proposals,
        executionRecords: this.supervisor.records(),
        agentActivityReportPath,
        improvementReportPath
      }
    };
  }

  async recordFeedback(
    context: ProjectContext,
    input: {
      agentId: string;
      taskId: string;
      context: string;
      detectedProblem: string;
      actionTaken: string;
      outcome: LearningRecord["outcome"];
      confidenceScore: number;
    }
  ): Promise<LearningRecord> {
    const record = this.learningStore.createRecord(input);
    const taskBoard = new AgentTaskBoard(context.taskBoardDir);
    const tasks = await taskBoard.loadAll();
    const nextState =
      input.outcome === "SUCCESSFUL_PROPOSAL"
        ? ("APPROVED" as const)
        : input.outcome === "REJECTED_PROPOSAL" || input.outcome === "FALSE_POSITIVE"
          ? ("REJECTED" as const)
          : ("ARCHIVED" as const);
    const updatedTasks = tasks.map((task) =>
      task.taskId === input.taskId
        ? {
            ...task,
            state: nextState,
            completedAt: new Date().toISOString()
          }
        : task
    );

    await this.learningStore.appendBatch(context.learningDir, [record]);
    await taskBoard.persist(updatedTasks);
    return record;
  }

  private async deriveLearnings(
    context: ProjectContext,
    tasks: GovernanceSummary["tasks"],
    rankedScores: AgentEvaluationScore[],
    agentReports: AgentReport[],
    previousLearnings: LearningRecord[]
  ): Promise<LearningRecord[]> {
    return tasks.flatMap((task) => {
      const report = agentReports.find((candidate) => candidate.agentId === task.agentId);
      const score = rankedScores.find((candidate) => candidate.taskId === task.taskId);

      if (!report || !score) {
        return [];
      }

      const records: LearningRecord[] = [];
      const leadFinding = report.findings[0] ?? "No major issue detected";
      const repeatedCount = previousLearnings.filter(
        (learning) => learning.detectedProblem.trim().toLowerCase() === leadFinding.trim().toLowerCase()
      ).length;

      if (report.agentId === "architecture-agent" && report.findings.length > 0) {
        records.push(
          this.learningStore.createRecord({
            agentId: report.agentId,
            taskId: task.taskId,
            context: `Repository ${context.repoName} architecture review`,
            detectedProblem: report.findings.join(" "),
            actionTaken: report.recommendations.join(" "),
            outcome: "ARCHITECTURAL_INSIGHT",
            confidenceScore: Math.max(score.overallScore, 0.7)
          })
        );
      }

      if (repeatedCount > 0 && report.findings.length > 0) {
        records.push(
          this.learningStore.createRecord({
            agentId: report.agentId,
            taskId: task.taskId,
            context: `Repeated pattern detected on trigger ${task.trigger} for ${context.repoName}`,
            detectedProblem: leadFinding,
            actionTaken: `Escalate pattern for governance review after ${repeatedCount + 1} consecutive detections.`,
            outcome: "REPEATED_BUG_PATTERN",
            confidenceScore: Math.max(score.overallScore, 0.75)
          })
        );
      }

      records.push(
        this.learningStore.createRecord({
          agentId: report.agentId,
          taskId: task.taskId,
          context: `Trigger ${task.trigger} on ${context.repoName}`,
          detectedProblem: leadFinding,
          actionTaken: report.recommendations[0] ?? "No proposal generated",
          outcome: score.overallScore >= 0.7 ? "PENDING_REVIEW" : "MISSED_ISSUE",
          confidenceScore: score.overallScore
        })
      );

      return records;
    });
  }

  private async writeImprovementProposals(
    context: ProjectContext,
    rankedScores: AgentEvaluationScore[],
    agentReports: AgentReport[]
  ): Promise<ProposalArtifact[]> {
    const proposals: ProposalArtifact[] = [];
    let proposalIndex = 1;

    try {
      const existing = await fs.readdir(context.proposalDir);
      await Promise.all(
        existing
          .filter((entry) => entry.startsWith("proposal_") && entry.endsWith(".md"))
          .map((entry) => fs.rm(path.join(context.proposalDir, entry), { force: true }))
      );
    } catch {
      // Proposal directory is best-effort cleanup; generation continues even if cleanup fails.
    }

    for (const score of sortByScore(rankedScores)) {
      const report = agentReports.find((candidate) => candidate.agentId === score.agentId);
      const registered = this.registry.get(score.agentId);
      if (!report || !registered || report.recommendations.length === 0) {
        continue;
      }

      const rawReportContent = await readTextSafe(report.outputPath);
      const reportAffectedFiles = extractAffectedFiles(rawReportContent);
      const decision = this.supervisor.classifyProposal(registered.descriptor, report, score);

      for (const recommendation of report.recommendations.slice(0, 2)) {
        const title = recommendation.split("->")[0]?.trim() || `${registered.descriptor.displayName} proposal`;
        const recommendationAffectedFiles = extractAffectedFiles(recommendation);
        const affectedFiles =
          recommendationAffectedFiles.length > 0
            ? recommendationAffectedFiles
            : reportAffectedFiles.length > 0
              ? reportAffectedFiles
              : defaultAffectedFiles(score.agentId, context);
        const expectedBenefit = expectedBenefitFor(score.agentId, report.riskLevel);
        const implementationSketch = implementationSketchFor(recommendation, affectedFiles);
        const proposalId = createProposalId(score.agentId, proposalIndex);
        const filePath = path.join(context.proposalDir, proposalFileName(score.agentId, proposalIndex, title));
        const content = `# ${title}

## Governance decision

- Status: ${decision.status}
- Rationale: ${decision.rationale}
- Source agent: ${registered.descriptor.displayName}
- Task score: ${score.overallScore}

## Description

${report.findings[0] ?? report.summary}

## Files affected

${renderList(affectedFiles)}

## Risk level

- ${report.riskLevel}

## Expected benefit

${expectedBenefit}

## Implementation sketch

${implementationSketch}

## Safety

- This is a proposal only.
- No production code, infrastructure, or pull request is modified automatically.
- Human approval is required before execution.
`;
        await writeFileEnsured(filePath, content);
        this.logger.info("Governance proposal generated", {
          component: "governance",
          agent: score.agentId,
          action: "proposal_generated",
          proposalId,
          decision: decision.status,
          filePath
        });

        proposals.push({
          proposalId,
          agentId: score.agentId,
          title,
          summary: report.summary,
          status: decision.status,
          filePath,
          riskLevel: report.riskLevel,
          affectedFiles,
          expectedBenefit,
          implementationSketch,
          decisionRationale: decision.rationale,
          sourceReportPath: report.outputPath,
          createdAt: new Date().toISOString()
        });
        proposalIndex += 1;

        if (proposals.length >= 8) {
          return proposals;
        }
      }
    }

    return proposals;
  }

  private applyProposalDecisions(
    tasks: GovernanceSummary["tasks"],
    proposals: ProposalArtifact[]
  ): GovernanceSummary["tasks"] {
    return tasks.map((task) => {
      const taskProposals = proposals.filter((proposal) => proposal.agentId === task.agentId);
      if (taskProposals.length === 0) {
        return task;
      }

      if (taskProposals.some((proposal) => proposal.status === "REQUIRES_HUMAN_REVIEW")) {
        this.logger.info("Task marked for human review", {
          component: "governance",
          agent: task.agentId,
          action: "governance_decision",
          taskId: task.taskId,
          decision: "REQUIRES_HUMAN_REVIEW"
        });
        return {
          ...task,
          state: "PROPOSED"
        };
      }

      if (taskProposals.some((proposal) => proposal.status === "APPROVED")) {
        this.logger.info("Task approved into backlog", {
          component: "governance",
          agent: task.agentId,
          action: "governance_decision",
          taskId: task.taskId,
          decision: "APPROVED"
        });
        return {
          ...task,
          state: "APPROVED"
        };
      }

      this.logger.warn("Task rejected by governance", {
        component: "governance",
        agent: task.agentId,
        action: "governance_decision",
        taskId: task.taskId,
        decision: "REJECTED"
      });
      return {
        ...task,
        state: "REJECTED"
      };
    });
  }

  private async writeAgentActivityReport(
    context: ProjectContext,
    trigger: GovernanceTrigger,
    tasks: GovernanceSummary["tasks"],
    rankedScores: AgentEvaluationScore[],
    previousLearnings: LearningRecord[],
    proposals: ProposalArtifact[],
    repeatedPatterns: string[]
  ): Promise<string> {
    const reportPath = path.join(context.reportsDir, "agent_activity_report.md");
    const approvedCount = proposals.filter((proposal) => proposal.status === "APPROVED").length;
    const reviewCount = proposals.filter((proposal) => proposal.status === "REQUIRES_HUMAN_REVIEW").length;
    const rejectedCount = proposals.filter((proposal) => proposal.status === "REJECTED").length;
    const content = `# Agent Activity Report

## Runtime overview

- Repository: ${context.repoName}
- Trigger: ${trigger}
- Agent execution count: ${tasks.length}
- Analysis coverage: ${tasks.filter((task) => task.state !== "NEW").length}/${tasks.length}
- Accepted vs rejected proposals: approved=${approvedCount}, requires_human_review=${reviewCount}, rejected=${rejectedCount}, historical learnings=${previousLearnings.length}
- Detected regressions: ${rankedScores.filter((score) => score.overallScore < 0.55).length}

## Active governance rules

${renderGovernanceRules()}

## Task lifecycle snapshot

${renderList(tasks.map((task) => `${task.taskId} | ${task.agentId} | ${task.state} | ${task.priority}`))}

## Agent scores

${renderList(
        rankedScores.map(
          (score) => `${score.rank}. ${score.agentId} | overall=${score.overallScore} | output=${score.outputQuality}`
        )
      )}

## Repeated learning patterns

${renderList(repeatedPatterns)}
`;
    await writeFileEnsured(reportPath, content);
    return reportPath;
  }

  private async writeImprovementReport(
    context: ProjectContext,
    rankedScores: AgentEvaluationScore[],
    agentReports: AgentReport[],
    proposals: ProposalArtifact[],
    conflicts: string[],
    repeatedPatterns: string[]
  ): Promise<string> {
    const reportPath = path.join(context.reportsDir, "improvement_proposals.md");
    const content = `# Improvement Report

## Ranked improvement proposals

${renderList(
        rankedScores.map((score) => {
          const report = agentReports.find((candidate) => candidate.agentId === score.agentId);
          return `${score.rank}. ${score.agentId} | score=${score.overallScore} | summary=${report?.summary ?? "N/A"}`;
        })
      )}

## Proposal artifacts

${renderList(
        proposals.map(
          (proposal) =>
            `${proposal.title} | status=${proposal.status} | risk=${proposal.riskLevel} | files=${proposal.affectedFiles.join(", ") || "None"} | path=${proposal.filePath}`
        )
      )}

## Expected benefits

${renderList(proposals.map((proposal) => `${proposal.title} -> ${proposal.expectedBenefit}`))}

## Conflict and escalation summary

${renderList(conflicts)}

## Repeated patterns from learning memory

${renderList(repeatedPatterns)}
`;
    await writeFileEnsured(reportPath, content);
    await writeFileEnsured(path.join(context.reportsDir, "improvement_report.md"), content);
    return reportPath;
  }
}
