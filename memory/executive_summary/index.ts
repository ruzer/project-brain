import path from "node:path";

import { listScopeMemoryRecords } from "../scope_store";
import { readJsonSafe, readTextSafe, uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ExecutiveSummaryResult, ProjectContext, ScopeMemoryRecord } from "../../shared/types";

interface SwarmMemoryShape {
  intent?: string;
  synthesis?: {
    headline?: string;
    summary?: string;
    verifiedFacts?: string[];
    verified_facts?: string[];
    unknowns?: string[];
    evidenceRefs?: string[];
    evidence_refs?: string[];
    priorities?: string[];
    nextSteps?: string[];
    next_steps?: string[];
  };
}

function inferProjectType(context: ProjectContext): string {
  const frameworks = new Set(context.discovery.frameworks);
  if (frameworks.has("NestJS") && frameworks.has("NextJS")) {
    return "Full-stack platform";
  }
  if (frameworks.has("FastAPI") || frameworks.has("Express") || frameworks.has("Spring")) {
    return "Backend API service";
  }
  if (frameworks.has("NextJS") || frameworks.has("React")) {
    return "Frontend application";
  }
  if (context.discovery.infrastructure.length > 0 && context.discovery.structure.sourceFileCount < 10) {
    return "Infrastructure-oriented project";
  }
  return "Software project";
}

function compactBullets(input: string, limit: number): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) && !/none recorded|none detected/i.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(-limit);
}

function normalizeList(items: Array<string | undefined>, limit: number): string[] {
  return uniqueSorted(items.filter((item): item is string => Boolean(item?.trim())).map((item) => item.trim())).slice(0, limit);
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function scopeStatuses(records: ScopeMemoryRecord[]): ExecutiveSummaryResult["scopeStatuses"] {
  return records
    .map((record) => ({
      scope: record.scope,
      freshness: record.freshness.status,
      coverage: record.coverage.status,
      facts: record.verifiedFacts.length,
      unknowns: record.unknowns.length,
      evidenceRefs: record.evidenceRefs.length,
      hashTruncated: Boolean(record.files.hashTruncated)
    }))
    .sort((left, right) => left.scope.localeCompare(right.scope));
}

function renderScopeTable(scopes: ExecutiveSummaryResult["scopeStatuses"]): string {
  if (scopes.length === 0) {
    return "- None";
  }

  return [
    "| Scope | Freshness | Coverage | Facts | Unknowns | Evidence | Hash truncated |",
    "|---|---|---|---:|---:|---:|---|",
    ...scopes.map(
      (scope) =>
        `| ${scope.scope} | ${scope.freshness} | ${scope.coverage} | ${scope.facts} | ${scope.unknowns} | ${scope.evidenceRefs} | ${scope.hashTruncated ? "yes" : "no"} |`
    )
  ].join("\n");
}

function renderExecutiveSummary(summary: ExecutiveSummaryResult): string {
  return `# EXECUTIVE_SUMMARY

## Identity

- Repository: ${summary.identity.repoName}
- Type: ${summary.identity.projectType}
- Target: ${summary.identity.targetPath}
- Output: ${summary.identity.outputPath}
- Generated: ${summary.generatedAt}

## What this project is

- Languages: ${summary.stack.languages.join(", ") || "Unknown"}
- Frameworks: ${summary.stack.frameworks.join(", ") || "Unknown"}
- APIs: ${summary.stack.apis.join(", ") || "Not detected"}
- Infrastructure: ${summary.stack.infrastructure.join(", ") || "Not detected"}
- Testing: ${summary.stack.testing.join(", ") || "Not detected"}

## Architecture snapshot

- Source files: ${summary.architecture.sourceFileCount}
- Test files: ${summary.architecture.testFileCount}
- Top-level directories: ${summary.architecture.topLevelDirectories.join(", ") || "None detected"}

## Current analysis state

- Scope records: ${summary.status.scopeCount}
- Fresh complete scopes: ${summary.status.completeFreshScopes}
- Stale scopes: ${summary.status.staleScopes}
- Partial scopes: ${summary.status.partialScopes}
- Latest swarm intent: ${summary.status.latestSwarmIntent ?? "None"}
- Latest swarm headline: ${summary.status.latestSwarmHeadline ?? "None"}

## Decisions

${renderList(summary.decisions)}

## Learnings

${renderList(summary.learnings)}

## Risks and unknowns

${renderList(summary.risksAndUnknowns)}

## Scope status

${renderScopeTable(summary.scopeStatuses)}

## Next actions

${renderList(summary.nextActions)}

## Evidence refs

${renderList(summary.evidenceRefs)}
`;
}

export async function writeExecutiveSummaryArtifacts(context: ProjectContext): Promise<ExecutiveSummaryResult> {
  const scopeRecords = await listScopeMemoryRecords(context);
  const scopes = scopeStatuses(scopeRecords);
  const swarm = await readJsonSafe<SwarmMemoryShape>(path.join(context.memoryDir, "swarm", "swarm_run.json"));
  const decisions = compactBullets(await readTextSafe(path.join(context.memoryDir, "DECISIONS.md")), 10);
  const learnings = compactBullets(await readTextSafe(path.join(context.memoryDir, "LEARNINGS.md")), 10);
  const errors = compactBullets(await readTextSafe(path.join(context.memoryDir, "ERRORS.md")), 10);
  const swarmUnknowns = normalizeList([...(swarm?.synthesis?.unknowns ?? [])], 8);
  const swarmNextSteps = normalizeList([...(swarm?.synthesis?.nextSteps ?? []), ...(swarm?.synthesis?.next_steps ?? []), ...(swarm?.synthesis?.priorities ?? [])], 10);
  const scopeUnknowns = normalizeList(scopeRecords.flatMap((record) => record.unknowns), 10);
  const evidenceRefs = normalizeList(
    [
      path.join(context.memoryDir, "MEMORY_BRIEF.md"),
      path.join(context.memoryDir, "PROJECT_MODEL.md"),
      path.join(context.memoryDir, "STACK_PROFILE.md"),
      path.join(context.runtimeMemoryDir, "scopes"),
      path.join(context.memoryDir, "swarm", "swarm_run.json"),
      ...(swarm?.synthesis?.evidenceRefs ?? []),
      ...(swarm?.synthesis?.evidence_refs ?? []),
      ...scopeRecords.flatMap((record) => record.evidenceRefs)
    ],
    20
  );
  const result: ExecutiveSummaryResult = {
    context,
    generatedAt: new Date().toISOString(),
    reportPath: path.join(context.memoryDir, "EXECUTIVE_SUMMARY.md"),
    memoryPath: path.join(context.runtimeMemoryDir, "executive_summary", "executive_summary.json"),
    identity: {
      repoName: context.repoName,
      targetPath: context.targetPath,
      outputPath: context.outputPath,
      projectType: inferProjectType(context)
    },
    stack: {
      languages: context.discovery.languages,
      frameworks: context.discovery.frameworks,
      apis: context.discovery.apis,
      infrastructure: context.discovery.infrastructure,
      testing: context.discovery.testing
    },
    architecture: {
      topLevelDirectories: context.discovery.structure.topLevelDirectories.slice(0, 24),
      sourceFileCount: context.discovery.structure.sourceFileCount,
      testFileCount: context.discovery.structure.testFileCount
    },
    status: {
      scopeCount: scopes.length,
      completeFreshScopes: scopes.filter((scope) => scope.freshness === "fresh" && scope.coverage === "complete").length,
      staleScopes: scopes.filter((scope) => scope.freshness === "stale").length,
      partialScopes: scopes.filter((scope) => scope.coverage === "partial").length,
      latestSwarmIntent: swarm?.intent,
      latestSwarmHeadline: swarm?.synthesis?.headline
    },
    decisions,
    learnings,
    risksAndUnknowns: normalizeList([...errors, ...swarmUnknowns, ...scopeUnknowns], 16),
    scopeStatuses: scopes,
    nextActions: normalizeList([...swarmNextSteps, ...context.discovery.recommendations], 14),
    evidenceRefs
  };

  await writeFileEnsured(result.reportPath, renderExecutiveSummary(result));
  await writeJsonEnsured(result.memoryPath, result);
  return result;
}
