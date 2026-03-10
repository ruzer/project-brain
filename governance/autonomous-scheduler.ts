import { AgentRegistry, type RegisteredAgent } from "./agent-registry";

import type { GovernanceTrigger } from "../shared/types";

export interface ScheduledCycle {
  cadence: "event-driven" | "daily" | "weekly";
  trigger: GovernanceTrigger;
  agentIds: string[];
  rationale: string;
}

export class AutonomousScheduler {
  constructor(private readonly registry: AgentRegistry) {}

  selectAgents(trigger: GovernanceTrigger): RegisteredAgent[] {
    const registered = this.registry.forTrigger(trigger);
    return registered.length > 0 ? registered : this.registry.list();
  }

  describeCycles(): ScheduledCycle[] {
    return [
      {
        cadence: "event-driven",
        trigger: "repository-change",
        agentIds: ["product-owner-agent", "qa-agent", "dev-agent", "documentation-agent"],
        rationale: "Immediate repo-change review focused on regressions, maintainability, and docs drift."
      },
      {
        cadence: "daily",
        trigger: "security-audit",
        agentIds: ["security-agent", "dependency-agent", "qa-agent"],
        rationale: "Security posture, dependency hygiene, and test-safety verification."
      },
      {
        cadence: "weekly",
        trigger: "weekly-review",
        agentIds: ["product-owner-agent", "qa-agent", "dev-agent", "optimization-agent", "documentation-agent"],
        rationale: "Weekly platform review of product friction, quality, performance, and documentation."
      },
      {
        cadence: "weekly",
        trigger: "architecture-review",
        agentIds: ["architecture-agent", "dev-agent", "optimization-agent", "observability-agent", "documentation-agent"],
        rationale: "Structured architecture drift review across runtime boundaries and operational readiness."
      }
    ];
  }
}
