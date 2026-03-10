import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDir, readJsonSafe, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import { StructuredLogger } from "../../shared/logger";
import type { AgentReport, GovernanceSummary, ProjectContext } from "../../shared/types";

export interface CycleTelemetry {
  cycleId: string;
  repo: string;
  cycleType: string;
  duration: number;
  cycleDuration: number;
  agentsExecuted: number;
  proposalsGenerated: number;
  risksDetected: number;
  timestamp: string;
  agentIds: string[];
  riskTypes: string[];
  proposalStatuses: Record<string, number>;
}

export interface CycleSpan {
  cycleId: string;
  cycleType: string;
  startedAt: number;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function uniqueRepositoryCount(records: CycleTelemetry[]): number {
  return new Set(records.filter((record) => record.repo !== "ecosystem").map((record) => record.repo)).size;
}

export class MetricsCollector {
  private readonly logger = new StructuredLogger("metrics-collector");

  private telemetryFileName(telemetry: CycleTelemetry): string {
    const repoSlug = telemetry.repo
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
    return `cycle_${telemetry.timestamp.replace(/[:.]/g, "-")}_${repoSlug || "repo"}.json`;
  }

  startCycle(cycleType: string, cycleId: string): CycleSpan {
    return {
      cycleId,
      cycleType,
      startedAt: Date.now()
    };
  }

  completeCycle(
    span: CycleSpan,
    repo: string,
    agentReports: AgentReport[],
    summary: GovernanceSummary | undefined
  ): CycleTelemetry {
    const duration = Date.now() - span.startedAt;
    const proposalStatuses = (summary?.proposals ?? []).reduce<Record<string, number>>((acc, proposal) => {
      acc[proposal.status] = (acc[proposal.status] ?? 0) + 1;
      return acc;
    }, {});

    return {
      cycleId: span.cycleId,
      repo,
      cycleType: span.cycleType,
      duration,
      cycleDuration: duration,
      agentsExecuted: summary?.executionRecords.filter((record) => record.status === "completed").length ?? agentReports.length,
      proposalsGenerated: summary?.proposals.length ?? 0,
      risksDetected: agentReports.reduce((count, report) => count + report.findings.length, 0),
      timestamp: new Date().toISOString(),
      agentIds: (summary?.tasks ?? []).map((task) => task.agentId),
      riskTypes: agentReports
        .filter((report) => report.findings.length > 0)
        .map((report) => report.riskLevel),
      proposalStatuses
    };
  }

  async persistCycleTelemetry(context: ProjectContext, telemetry: CycleTelemetry): Promise<string> {
    return this.persistTelemetry(context.reportsDir, telemetry);
  }

  async persistTelemetry(reportsDir: string, telemetry: CycleTelemetry): Promise<string> {
    const telemetryDir = path.join(reportsDir, "telemetry");
    const fileName = this.telemetryFileName(telemetry);
    const filePath = path.join(telemetryDir, fileName);

    await ensureDir(telemetryDir);
    await writeJsonEnsured(filePath, telemetry);

    this.logger.info("Persisted cycle telemetry", {
      component: "telemetry",
      action: "telemetry_persisted",
      cycleId: telemetry.cycleId,
      filePath
    });

    return filePath;
  }

  async writeRuntimeObservabilityReport(reportsDir: string): Promise<string> {
    const telemetryDir = path.join(reportsDir, "telemetry");
    let telemetryFiles: string[] = [];

    try {
      telemetryFiles = (await fs.readdir(telemetryDir))
        .filter((fileName) => fileName.startsWith("cycle_") && fileName.endsWith(".json"))
        .sort((left, right) => left.localeCompare(right));
    } catch {
      telemetryFiles = [];
    }

    const telemetryRecords = (
      await Promise.all(
        telemetryFiles.map((fileName) => readJsonSafe<CycleTelemetry>(path.join(telemetryDir, fileName)))
      )
    ).filter(Boolean) as CycleTelemetry[];
    const granularRecords = telemetryRecords.filter((record) => record.repo !== "ecosystem");
    const reportSource = granularRecords.length > 0 ? granularRecords : telemetryRecords;

    const averageCycleDuration =
      telemetryRecords.length > 0
        ? Math.round(telemetryRecords.reduce((sum, record) => sum + record.cycleDuration, 0) / telemetryRecords.length)
        : 0;
    const mostActiveAgents = [...reportSource.reduce<Map<string, number>>((acc, record) => {
      for (const agentId of record.agentIds) {
        acc.set(agentId, (acc.get(agentId) ?? 0) + 1);
      }
      return acc;
    }, new Map())]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([agentId, count]) => `${agentId}: ${count}`);
    const mostCommonRiskTypes = [...reportSource.reduce<Map<string, number>>((acc, record) => {
      for (const riskType of record.riskTypes) {
        acc.set(riskType, (acc.get(riskType) ?? 0) + 1);
      }
      return acc;
    }, new Map())]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([riskType, count]) => `${riskType}: ${count}`);
    const proposalFrequency =
      reportSource.length > 0
        ? (reportSource.reduce((sum, record) => sum + record.proposalsGenerated, 0) / reportSource.length).toFixed(2)
        : "0.00";
    const reportPath = path.join(reportsDir, "runtime_observability.md");
    const content = `# Runtime Observability

## Summary

- Average cycle duration: ${averageCycleDuration} ms
- Telemetry files tracked: ${telemetryRecords.length}
- Repositories observed: ${uniqueRepositoryCount(telemetryRecords)}
- Improvement proposal frequency: ${proposalFrequency} proposals per cycle

## Most Active Agents

${renderList(mostActiveAgents)}

## Repository Activity

${renderList(
      [...telemetryRecords.reduce<Map<string, number>>((acc, record) => {
        acc.set(record.repo, (acc.get(record.repo) ?? 0) + 1);
        return acc;
      }, new Map())]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 10)
        .map(([repo, count]) => `${repo}: ${count}`)
    )}

## Most Common Risk Types

${renderList(mostCommonRiskTypes)}

## Proposal Status Distribution

${renderList(
      [...telemetryRecords.reduce<Map<string, number>>((acc, record) => {
        for (const [status, count] of Object.entries(record.proposalStatuses)) {
          acc.set(status, (acc.get(status) ?? 0) + count);
        }
        return acc;
      }, new Map())]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([status, count]) => `${status}: ${count}`)
    )}
`;

    await writeFileEnsured(reportPath, content);
    return reportPath;
  }
}
