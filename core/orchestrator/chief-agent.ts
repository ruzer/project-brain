import { buildAgentCatalog, type AgentCatalogEntry } from "../../agents/catalog";
import { StructuredLogger } from "../../shared/logger";
import type { AgentReport, ProjectContext } from "../../shared/types";

export class ChiefAgent {
  private readonly logger = new StructuredLogger("chief-agent");
  private readonly catalog = buildAgentCatalog();
  private readonly agents = this.catalog.map((entry) => entry.agent);

  listCatalog(): AgentCatalogEntry[] {
    return [...this.catalog];
  }

  async run(context: ProjectContext): Promise<AgentReport[]> {
    this.logger.info("Running specialist agents", {
      repoName: context.repoName,
      agents: this.agents.map((agent) => agent.agentId)
    });

    const reports: AgentReport[] = [];

    for (const agent of this.agents) {
      reports.push(await agent.run(context));
    }

    return reports;
  }
}
