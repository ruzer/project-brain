import path from "node:path";

import { assessMemoryReadiness } from "../../memory/readiness";
import { fileExists, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { HarnessAuditCheck, HarnessAuditMemoryLayer, HarnessAuditResult, ProjectContext } from "../../shared/types";

function outputFlag(context: ProjectContext): string {
  return `--output "${context.outputPath}"`;
}

async function existing(paths: string[]): Promise<string[]> {
  const pairs = await Promise.all(paths.map(async (filePath) => ({ filePath, exists: await fileExists(filePath) })));
  return pairs.filter((pair) => pair.exists).map((pair) => pair.filePath);
}

function layer(
  id: string,
  label: string,
  artifacts: string[],
  present: string[],
  tokenCost: HarnessAuditMemoryLayer["tokenCost"],
  purpose: string
): HarnessAuditMemoryLayer {
  const presentCount = artifacts.filter((artifact) => present.includes(artifact)).length;
  const status: HarnessAuditMemoryLayer["status"] =
    presentCount === artifacts.length ? "ready" : presentCount > 0 ? "partial" : "missing";

  return {
    id,
    label,
    status,
    tokenCost,
    artifacts,
    purpose
  };
}

function check(
  id: string,
  label: string,
  status: HarnessAuditCheck["status"],
  summary: string,
  evidence: string[],
  recommendation?: string
): HarnessAuditCheck {
  return {
    id,
    label,
    status,
    summary,
    evidence,
    recommendation
  };
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderAudit(result: HarnessAuditResult): string {
  return `# Harness Audit

## Summary

- Repository: ${result.context.repoName}
- Target: ${result.context.targetPath}
- Output: ${result.context.outputPath}
- Generated: ${result.generatedAt}
- Score: ${result.score}
- Token risk: ${result.tokenRisk}
- Memory readiness: ${result.memoryReadiness.status}
- Memory reason: ${result.memoryReadiness.reason}

## Memory Layers

${result.memoryLayers
  .map(
    (layerResult) => `### ${layerResult.label}

- Status: ${layerResult.status}
- Token cost: ${layerResult.tokenCost}
- Purpose: ${layerResult.purpose}
- Artifacts:
${renderList(layerResult.artifacts)}
`
  )
  .join("\n")}

## Checks

${result.checks
  .map(
    (item) => `### ${item.label}

- Status: ${item.status}
- Summary: ${item.summary}
- Evidence:
${renderList(item.evidence)}
- Recommendation: ${item.recommendation ?? "None"}
`
  )
  .join("\n")}

## Suggested Commands

${renderList(result.suggestedCommands)}
`;
}

export async function runHarnessAudit(context: ProjectContext): Promise<HarnessAuditResult> {
  const output = outputFlag(context);
  const doctorPath = path.join(context.memoryDir, "doctor", "doctor.json");
  const memoryBriefPath = path.join(context.memoryDir, "MEMORY_BRIEF.md");
  const memoryBriefJsonPath = path.join(context.runtimeMemoryDir, "memory_brief", "memory_brief.json");
  const mapPath = path.join(context.docsDir, "codebase_map", "SUMMARY.md");
  const factGraphPath = path.join(context.runtimeMemoryDir, "knowledge_graph", "repository_fact_graph.json");
  const factQueryPath = path.join(context.reportsDir, "fact_query.md");
  const runbookPath = path.join(context.reportsDir, "runbook.md");
  const firewallPath = path.join(context.reportsDir, "agent_firewall.md");
  const swarmPath = path.join(context.memoryDir, "swarm", "swarm_run.json");
  const planPath = path.join(context.docsDir, "improvement_plan", "SUMMARY.md");

  const allArtifacts = [
    doctorPath,
    memoryBriefPath,
    memoryBriefJsonPath,
    mapPath,
    factGraphPath,
    factQueryPath,
    runbookPath,
    firewallPath,
    swarmPath,
    planPath
  ];
  const present = await existing(allArtifacts);
  const has = (filePath: string): boolean => present.includes(filePath);
  const memoryReadiness = await assessMemoryReadiness(context);

  const memoryLayers: HarnessAuditMemoryLayer[] = [
    layer(
      "compact-index",
      "Compact Memory Index",
      [memoryBriefPath, memoryBriefJsonPath],
      present,
      "low",
      "Small handoff that should be read before broad analysis."
    ),
    layer(
      "factual-graph",
      "Factual Structure Graph",
      [mapPath, factGraphPath],
      present,
      "low",
      "Deterministic repository facts and evidence paths."
    ),
    layer(
      "filtered-context",
      "Filtered Context Query",
      [factQueryPath],
      present,
      "low",
      "Narrow matching facts before loading detailed reports."
    ),
    layer(
      "execution-control",
      "Execution Control",
      [doctorPath, runbookPath, firewallPath],
      present,
      "medium",
      "Runtime readiness, ordered steps, and policy boundaries."
    ),
    layer(
      "deep-analysis",
      "Deep Analysis Memory",
      [swarmPath, planPath],
      present,
      "high",
      "Expensive findings and durable direction after cheap context exists."
    )
  ];

  const checks: HarnessAuditCheck[] = [
    check(
      "memory-readiness",
      "Memory Readiness",
      memoryReadiness.status === "ready" ? "pass" : memoryReadiness.status === "stale" ? "warn" : "fail",
      memoryReadiness.reason,
      [memoryReadiness.memoryBriefPath, memoryReadiness.memoryBriefJsonPath].filter((artifactPath) => present.includes(artifactPath)),
      memoryReadiness.status === "ready" ? undefined : `project-brain start "optimize analysis and cost" . ${output}`
    ),
    check(
      "progressive-disclosure",
      "Progressive Disclosure",
      has(memoryBriefPath) && has(factGraphPath) && has(factQueryPath) ? "pass" : has(memoryBriefPath) || has(factGraphPath) ? "warn" : "fail",
      "Memory should be consumed as compact index, factual graph, then detailed artifacts.",
      [memoryBriefPath, factGraphPath, factQueryPath].filter(has),
      has(factQueryPath) ? undefined : `project-brain fact-query "memory optimization" . ${output}`
    ),
    check(
      "preflight-before-models",
      "Preflight Before Models",
      has(doctorPath) && has(runbookPath) && has(firewallPath) ? "pass" : has(doctorPath) || has(runbookPath) ? "warn" : "fail",
      "Model-heavy runs should have local readiness, an ordered runbook, and governance visibility.",
      [doctorPath, runbookPath, firewallPath].filter(has),
      !has(doctorPath)
        ? `project-brain doctor . ${output}`
        : !has(runbookPath)
          ? `project-brain runbook "optimize analysis and cost" . ${output}`
          : !has(firewallPath)
            ? `project-brain firewall . --trigger repository-change ${output}`
            : undefined
    ),
    check(
      "cost-gate",
      "Cost Gate",
      has(swarmPath) ? (has(factGraphPath) && has(factQueryPath) ? "pass" : "warn") : has(factGraphPath) && has(factQueryPath) ? "pass" : "warn",
      "Swarm and cloud-capable work should come after deterministic facts and filtered context.",
      [factGraphPath, factQueryPath, swarmPath].filter(has),
      has(factGraphPath) && has(factQueryPath) ? undefined : `project-brain code-graph . ${output}`
    ),
    check(
      "continuity",
      "Continuity",
      has(planPath) ? "pass" : has(swarmPath) ? "warn" : "fail",
      "Findings should become durable decisions or roadmap items so future runs do not repeat the same analysis.",
      [swarmPath, planPath].filter(has),
      has(swarmPath) && !has(planPath) ? `project-brain plan-improvements . ${output}` : undefined
    )
  ];

  const score = Number((checks.reduce((sum, item) => sum + (item.status === "pass" ? 1 : item.status === "warn" ? 0.5 : 0), 0) / checks.length).toFixed(2));
  const tokenRisk: HarnessAuditResult["tokenRisk"] = score >= 0.75 ? "low" : score >= 0.5 ? "medium" : "high";
  const suggestedCommands = checks
    .map((item) => item.recommendation)
    .filter((item): item is string => Boolean(item));
  const result: HarnessAuditResult = {
    context,
    generatedAt: new Date().toISOString(),
    reportPath: path.join(context.reportsDir, "harness_audit.md"),
    memoryPath: path.join(context.memoryDir, "harness_audit", "harness_audit.json"),
    score,
    tokenRisk,
    memoryReadiness,
    checks,
    memoryLayers,
    suggestedCommands
  };

  await writeJsonEnsured(result.memoryPath, {
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    generatedAt: result.generatedAt,
    score,
    tokenRisk,
    memoryReadiness,
    checks,
    memoryLayers,
    suggestedCommands
  });
  await writeFileEnsured(result.reportPath, renderAudit(result));
  return result;
}
