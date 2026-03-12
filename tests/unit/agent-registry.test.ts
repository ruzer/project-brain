import { describe, expect, it } from "vitest";

import { buildAgentCatalog } from "../../agents/catalog";
import { AgentRegistry } from "../../governance/agent-registry";

describe("AgentRegistry", () => {
  it("loads the full governed agent catalog and filters by trigger", () => {
    const registry = new AgentRegistry();
    registry.registerAll(buildAgentCatalog());

    const allAgents = registry.list();
    const weeklyAgents = registry.forTrigger("weekly-review");
    const architectureReviewAgents = registry.forTrigger("architecture-review");
    const securityAuditAgents = registry.forTrigger("security-audit");

    expect(allAgents.length).toBeGreaterThanOrEqual(10);
    expect(allAgents.some((agent) => agent.descriptor.agentId === "qa-agent")).toBe(true);
    expect(allAgents.some((agent) => agent.descriptor.agentId === "ux-agent")).toBe(true);
    expect(allAgents.some((agent) => agent.descriptor.agentId === "ux-improvement-agent")).toBe(true);
    expect(weeklyAgents.some((agent) => agent.descriptor.agentId === "architecture-agent")).toBe(true);
    expect(weeklyAgents.some((agent) => agent.descriptor.agentId === "documentation-agent")).toBe(true);
    expect(weeklyAgents.some((agent) => agent.descriptor.agentId === "ux-agent")).toBe(true);
    expect(weeklyAgents.some((agent) => agent.descriptor.agentId === "ux-improvement-agent")).toBe(true);
    expect(architectureReviewAgents.some((agent) => agent.descriptor.agentId === "architecture-agent")).toBe(true);
    expect(architectureReviewAgents.some((agent) => agent.descriptor.agentId === "dev-agent")).toBe(true);
    expect(securityAuditAgents.some((agent) => agent.descriptor.agentId === "security-agent")).toBe(true);
  });
});
