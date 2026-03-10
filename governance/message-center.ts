import path from "node:path";

import { writeJsonEnsured } from "../shared/fs-utils";
import type { AgentMessage, AgentPriority, AgentReport, AgentTask } from "../shared/types";

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export class AgentMessageCenter {
  private readonly messages: AgentMessage[] = [];

  send(message: Omit<AgentMessage, "messageId" | "timestamp">): AgentMessage {
    const envelope: AgentMessage = {
      ...message,
      messageId: createMessageId(),
      timestamp: new Date().toISOString()
    };
    this.messages.push(envelope);
    return envelope;
  }

  seedTaskAssignments(tasks: AgentTask[], trigger: string): void {
    for (const task of tasks) {
      this.send({
        sender: "AgentCouncil",
        recipient: task.agentId,
        taskId: task.taskId,
        type: "QUESTION",
        payload: {
          instruction: task.description,
          trigger,
          rationale: task.rationale
        },
        priority: task.priority
      });
    }
  }

  recordAnalysisResult(task: AgentTask, report: AgentReport): void {
    this.send({
      sender: task.agentId,
      recipient: "AgentCouncil",
      taskId: task.taskId,
      type: "ANALYSIS_RESULT",
      payload: {
        title: report.title,
        riskLevel: report.riskLevel,
        findingsCount: report.findings.length,
        recommendationsCount: report.recommendations.length
      },
      priority: task.priority
    });
  }

  coordinateFollowUps(task: AgentTask, report: AgentReport): void {
    if (task.agentId === "security-agent" && report.riskLevel === "high") {
      this.send({
        sender: "security-agent",
        recipient: "dev-agent",
        taskId: task.taskId,
        type: "ESCALATION",
        payload: {
          reason: "High-risk security finding needs engineering follow-up.",
          summary: report.summary
        },
        priority: "critical"
      });
    }

    if (task.agentId === "architecture-agent" && report.findings.length > 0) {
      this.send({
        sender: "architecture-agent",
        recipient: "documentation-agent",
        taskId: task.taskId,
        type: "FEEDBACK",
        payload: {
          reason: "Architecture findings should be reflected in docs.",
          findings: report.findings
        },
        priority: "high"
      });
    }

    if (task.agentId === "qa-agent" && report.riskLevel === "high") {
      this.send({
        sender: "qa-agent",
        recipient: "product-owner-agent",
        taskId: task.taskId,
        type: "PROPOSAL",
        payload: {
          reason: "Quality risk should influence product prioritization.",
          recommendations: report.recommendations
        },
        priority: "high"
      });
    }
  }

  escalateToHuman(task: AgentTask, reason: string, priority: AgentPriority): void {
    this.send({
      sender: "AgentCouncil",
      recipient: "HumanApproval",
      taskId: task.taskId,
      type: "ESCALATION",
      payload: { reason },
      priority
    });
  }

  list(): AgentMessage[] {
    return [...this.messages];
  }

  async persist(taskBoardDir: string): Promise<void> {
    await writeJsonEnsured(path.join(taskBoardDir, "messages.json"), this.messages);
  }
}
