import { uniqueSorted } from "../shared/fs-utils";
import type { AgentTask, GovernanceTrigger, LearningRecord } from "../shared/types";

import type { RegisteredAgent } from "./agent-registry";

const PRIORITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1
};

function createTaskId(agentId: string, index: number): string {
  return `task_${agentId}_${Date.now()}_${index}`;
}

function priorityFor(trigger: GovernanceTrigger, agentId: string): AgentTask["priority"] {
  const matrix: Partial<Record<GovernanceTrigger, Partial<Record<string, AgentTask["priority"]>>>> = {
    "security-advisory": {
      "security-agent": "critical",
      "dependency-agent": "high"
    },
    "security-audit": {
      "security-agent": "critical",
      "dependency-agent": "high",
      "qa-agent": "high",
      "dev-agent": "normal"
    },
    "architecture-review": {
      "architecture-agent": "critical",
      "dev-agent": "high",
      "optimization-agent": "high",
      "observability-agent": "normal",
      "documentation-agent": "normal"
    },
    "dependency-update": {
      "dependency-agent": "critical",
      "security-agent": "high",
      "qa-agent": "normal"
    },
    "incident-detection": {
      "observability-agent": "critical",
      "qa-agent": "high",
      "architecture-agent": "high",
      "optimization-agent": "high"
    },
    "repository-change": {
      "dev-agent": "high",
      "qa-agent": "high",
      "ux-agent": "high",
      "ux-improvement-agent": "high",
      "documentation-agent": "normal",
      "security-agent": "normal"
    },
    "weekly-review": {
      "product-owner-agent": "high",
      "qa-agent": "high",
      "ux-agent": "high",
      "ux-improvement-agent": "high",
      "dev-agent": "high",
      "architecture-agent": "high",
      "optimization-agent": "high",
      "documentation-agent": "high",
      "legal-agent": "normal"
    },
    manual: {
      "security-agent": "high",
      "qa-agent": "high"
    }
  };

  return matrix[trigger]?.[agentId] ?? "normal";
}

export class AgentCouncil {
  planTasks(
    agents: RegisteredAgent[],
    trigger: GovernanceTrigger,
    previousLearnings: LearningRecord[]
  ): AgentTask[] {
    const learnedAgents = new Set(
      previousLearnings
        .filter((learning) => ["MISSED_ISSUE", "FALSE_POSITIVE"].includes(learning.outcome))
        .map((learning) => learning.agentId)
    );

    const tasks = agents.map((entry, index) => {
      const learnedPriorityBoost = learnedAgents.has(entry.descriptor.agentId);
      const priority = priorityFor(trigger, entry.descriptor.agentId);

      return {
        taskId: createTaskId(entry.descriptor.agentId, index + 1),
        agentId: entry.descriptor.agentId,
        title: `${entry.descriptor.displayName} analysis`,
        description: `Run ${entry.descriptor.displayName} for trigger ${trigger} and return recommendations.`,
        trigger,
        priority: learnedPriorityBoost && priority === "normal" ? "high" : priority,
        state: "NEW",
        createdAt: new Date().toISOString(),
        rationale: learnedPriorityBoost
          ? "Previous learnings indicate this agent needs closer follow-up."
          : `Selected by AgentCouncil for ${trigger}.`
      } satisfies AgentTask;
    });

    return tasks.sort((left, right) => PRIORITY_ORDER[right.priority] - PRIORITY_ORDER[left.priority]);
  }

  resolveConflicts(tasks: AgentTask[], reports: Array<{ agentId: string; recommendations: string[] }>): string[] {
    const structuralAgents = uniqueSorted(
      reports
        .filter((report) =>
          report.recommendations.some((recommendation) =>
            /architecture|structural|refactor|boundary/i.test(recommendation)
          )
        )
        .map((report) => report.agentId)
    );

    const conflicts: string[] = [];

    if (structuralAgents.length > 1) {
      conflicts.push(
        `Multiple agents proposed structural changes (${structuralAgents.join(", ")}); human architecture review is required.`
      );
    }

    if (tasks.some((task) => task.priority === "critical") && reports.length === 0) {
      conflicts.push("Critical tasks completed without agent reports; investigate runtime failures.");
    }

    return conflicts;
  }
}
