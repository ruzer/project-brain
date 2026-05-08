import path from "node:path";

import { buildWorkflowRuntimeDefinitions, type WorkflowRuntimeDefinition } from "../../core/workflow_registry";
import { writeExecutiveSummaryArtifacts } from "../../memory/executive_summary";
import { fileExists, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectContext, RunbookResult, RunbookStep } from "../../shared/types";

async function artifactExists(filePath: string): Promise<boolean> {
  return fileExists(filePath);
}

function stepFromWorkflow(
  id: string,
  workflow: WorkflowRuntimeDefinition,
  status: RunbookStep["status"],
): RunbookStep {
  return {
    id,
    title: workflow.humanLabel,
    status,
    command: workflow.command,
    rationale: workflow.rationale,
    cheap: workflow.cheap,
    usesModel: workflow.usesModel,
    evidence: workflow.artifactPaths
  };
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderRunbook(result: RunbookResult): string {
  return `# Runbook

## Intent

- Repository: ${result.context.repoName}
- Intent: ${result.intent}
- Generated: ${result.generatedAt}

## Principle

Run deterministic memory and graph steps before model-heavy analysis.

## Executive Summary

- Markdown: ${result.executiveSummary.reportPath}
- JSON: ${result.executiveSummary.memoryPath}
- Scopes: ${result.executiveSummary.status.scopeCount}
- Fresh complete scopes: ${result.executiveSummary.status.completeFreshScopes}
- Stale scopes: ${result.executiveSummary.status.staleScopes}

## Steps

${result.steps
  .map(
    (item) => `### ${item.id}. ${item.title}

- Status: ${item.status}
- Cheap: ${item.cheap ? "yes" : "no"}
- Uses model: ${item.usesModel ? "yes" : "no"}
- Command: \`${item.command}\`
- Rationale: ${item.rationale}
- Evidence:
${renderList(item.evidence)}
`
  )
  .join("\n")}

## Next Commands

${renderList(result.steps.filter((item) => item.status !== "done").slice(0, 4).map((item) => item.command))}
`;
}

export async function buildRunbook(context: ProjectContext, intent: string): Promise<RunbookResult> {
  const workflows = buildWorkflowRuntimeDefinitions(context, intent).filter((workflow) =>
    ["doctor", "map-codebase", "code-graph", "fact-query", "harness-audit", "firewall", "swarm", "plan-improvements", "resume"].includes(workflow.workflowId)
  );
  const existsByWorkflow = new Map<string, boolean>();
  for (const workflow of workflows) {
    const exists = (await Promise.all(workflow.artifactPaths.map((artifactPath) => artifactExists(artifactPath)))).some(Boolean);
    existsByWorkflow.set(workflow.workflowId, exists);
  }
  const memoryBriefExists = await artifactExists(path.join(context.memoryDir, "MEMORY_BRIEF.md"));
  const statusFor = (workflow: WorkflowRuntimeDefinition): RunbookStep["status"] => {
    if (workflow.workflowId === "resume") {
      return "ready";
    }
    if (existsByWorkflow.get(workflow.workflowId)) {
      return "done";
    }
    if (workflow.workflowId === "fact-query") {
      return existsByWorkflow.get("code-graph") && memoryBriefExists ? "ready" : "blocked";
    }
    if (workflow.workflowId === "harness-audit") {
      return memoryBriefExists || existsByWorkflow.get("code-graph") ? "ready" : "pending";
    }
    if (workflow.workflowId === "swarm") {
      return existsByWorkflow.get("code-graph") && existsByWorkflow.get("fact-query") ? "ready" : "blocked";
    }
    if (workflow.workflowId === "plan-improvements") {
      return existsByWorkflow.get("swarm") ? "ready" : "blocked";
    }
    return "pending";
  };
  const steps = workflows.map((workflow, index) => stepFromWorkflow(String(index + 1).padStart(2, "0"), workflow, statusFor(workflow)));
  const executiveSummary = await writeExecutiveSummaryArtifacts(context);
  const result: RunbookResult = {
    context,
    intent,
    generatedAt: new Date().toISOString(),
    reportPath: path.join(context.reportsDir, "runbook.md"),
    memoryPath: path.join(context.memoryDir, "runbook", "runbook.json"),
    executiveSummary,
    steps
  };

  await writeJsonEnsured(result.memoryPath, {
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    intent,
    generatedAt: result.generatedAt,
    executiveSummary: {
      reportPath: executiveSummary.reportPath,
      memoryPath: executiveSummary.memoryPath,
      status: executiveSummary.status
    },
    steps
  });
  await writeFileEnsured(result.reportPath, renderRunbook(result));
  return result;
}
