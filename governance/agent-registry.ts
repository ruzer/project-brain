import type { AgentCatalogEntry } from "../agents/catalog";
import { StructuredLogger } from "../shared/logger";
import type { GovernanceTrigger } from "../shared/types";

export interface RegisteredAgent extends AgentCatalogEntry {}

export class AgentRegistry {
  private readonly agents = new Map<string, RegisteredAgent>();
  private readonly logger = new StructuredLogger("agent-registry");

  register(entry: AgentCatalogEntry): void {
    this.agents.set(entry.descriptor.agentId, entry);
    this.logger.debug("Registered agent", {
      component: "agent",
      agent: entry.descriptor.agentId,
      action: "register",
      version: entry.descriptor.version
    });
  }

  registerAll(entries: AgentCatalogEntry[]): void {
    for (const entry of entries) {
      this.register(entry);
    }
  }

  list(): RegisteredAgent[] {
    return [...this.agents.values()];
  }

  get(agentId: string): RegisteredAgent | undefined {
    const entry = this.agents.get(agentId);
    this.logger.debug("Resolved agent from registry", {
      component: "agent",
      agent: agentId,
      action: "registry_lookup",
      found: Boolean(entry)
    });
    return entry;
  }

  forTrigger(trigger: GovernanceTrigger): RegisteredAgent[] {
    if (trigger === "manual") {
      return this.list();
    }

    const selected = this.list().filter((entry) => entry.descriptor.triggers.includes(trigger));
    for (const entry of selected) {
      this.logger.info("Selected agent for trigger", {
        component: "agent",
        agent: entry.descriptor.agentId,
        action: "analysis_start",
        trigger
      });
    }
    return selected;
  }
}
