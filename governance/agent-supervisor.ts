import { StructuredLogger } from "../shared/logger";
import type {
  AgentDescriptor,
  AgentEvaluationScore,
  AgentExecutionRecord,
  AgentReport,
  AgentTask,
  ProposalStatus
} from "../shared/types";

const SAFE_ACTIONS = new Set(["analyze", "propose", "report"]);
const SENSITIVE_SIGNALS = ["architecture", "structural", "security", "auth", "infra", "secret", "compliance"];

export const GOVERNANCE_RULES = [
  "Agents cannot execute destructive operations.",
  "Agents cannot commit code.",
  "Agents cannot merge pull requests.",
  "Agents cannot deploy infrastructure.",
  "Agents can only analyze, propose, and report.",
  "Human approval is required for structural changes, architectural decisions, and security-sensitive proposals."
];

export class AgentSupervisor {
  private readonly logger = new StructuredLogger("agent-supervisor");
  private readonly executionRecords: AgentExecutionRecord[] = [];

  enforceSafety(descriptor: AgentDescriptor): void {
    for (const action of descriptor.allowedActions) {
      if (!SAFE_ACTIONS.has(action)) {
        throw new Error(`Unsafe agent action detected for ${descriptor.agentId}: ${action}`);
      }
    }
  }

  start(task: AgentTask, descriptor: AgentDescriptor): void {
    this.enforceSafety(descriptor);
    this.executionRecords.push({
      agentId: descriptor.agentId,
      taskId: task.taskId,
      startedAt: new Date().toISOString(),
      status: "running"
    });
    this.logger.info("Agent execution started", {
      component: "agent",
      agent: descriptor.agentId,
      action: "agent_start",
      taskId: task.taskId
    });
  }

  complete(taskId: string): void {
    this.executionRecords.forEach((record) => {
      if (record.taskId === taskId && record.status === "running") {
        record.completedAt = new Date().toISOString();
        record.status = "completed";
        this.logger.info("Agent execution completed", {
          component: "agent",
          agent: record.agentId,
          action: "agent_complete",
          taskId: record.taskId
        });
      }
    });
  }

  fail(taskId: string, error: string): void {
    this.executionRecords.forEach((record) => {
      if (record.taskId === taskId && record.status === "running") {
        record.completedAt = new Date().toISOString();
        record.status = "failed";
        record.error = error;
        this.logger.error("Agent execution failed", {
          component: "agent",
          agent: record.agentId,
          action: "agent_failed",
          taskId: record.taskId,
          error
        });
      }
    });
  }

  requiresHumanApproval(descriptor: AgentDescriptor, report: AgentReport): boolean {
    const combinedText = `${report.findings.join(" ")} ${report.recommendations.join(" ")}`.toLowerCase();
    return (
      descriptor.requiresHumanApprovalFor.length > 0 &&
      SENSITIVE_SIGNALS.some((signal) => combinedText.includes(signal))
    );
  }

  classifyProposal(
    descriptor: AgentDescriptor,
    report: AgentReport,
    score: AgentEvaluationScore
  ): { status: ProposalStatus; rationale: string } {
    const combinedText = `${report.findings.join(" ")} ${report.recommendations.join(" ")}`.toLowerCase();
    const hasSensitiveSignal = SENSITIVE_SIGNALS.some((signal) => combinedText.includes(signal));

    if (report.recommendations.length === 0 || score.overallScore < 0.45) {
      return {
        status: "REJECTED",
        rationale: "Proposal rejected because the agent signal was too weak or no actionable recommendation was produced."
      };
    }

    if (this.requiresHumanApproval(descriptor, report) || report.riskLevel === "high" || hasSensitiveSignal) {
      return {
        status: "REQUIRES_HUMAN_REVIEW",
        rationale: "Proposal touches a governed or high-risk area and must be reviewed by a human before backlog approval."
      };
    }

    if (score.overallScore >= 0.72) {
      return {
        status: "APPROVED",
        rationale: "Proposal is actionable, low-risk, and strong enough to be approved into the human backlog."
      };
    }

    return {
      status: "REQUIRES_HUMAN_REVIEW",
      rationale: "Proposal is plausible but needs human review because the confidence signal is not yet strong enough for automatic backlog approval."
    };
  }

  records(): AgentExecutionRecord[] {
    return [...this.executionRecords];
  }
}
