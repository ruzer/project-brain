import path from "node:path";

import { collectFactQuery } from "../fact_query";
import { listScopeMemoryRecords } from "../scope_store";
import { fileExists, readJsonSafe, uniqueSorted } from "../../shared/fs-utils";
import type { ExecutiveSummaryResult, PreflightFactsResult, ProjectContext } from "../../shared/types";

interface PreflightFactsOptions {
  scope?: string;
  scopePaths?: string[];
  maxFacts?: number;
}

function confidenceFor(result: {
  memoryMatches: unknown[];
  scopeMemoryMatches?: unknown[];
  nodeMatches: unknown[];
  edgeMatches: unknown[];
  executiveFacts: string[];
}): PreflightFactsResult["confidence"] {
  if ((result.scopeMemoryMatches?.length ?? 0) > 0 || result.memoryMatches.length > 0) {
    return "high";
  }
  if (result.nodeMatches.length > 0 || result.edgeMatches.length > 0) {
    return "medium";
  }
  if (result.executiveFacts.length > 0) {
    return "low";
  }
  return "none";
}

function nextActionFor(
  confidence: PreflightFactsResult["confidence"],
  hasFactGraph: boolean,
  staleScopes: string[]
): PreflightFactsResult["recommendedNextAction"] {
  if (!hasFactGraph) {
    return "run-code-graph";
  }
  if (staleScopes.length > 0) {
    return "run-swarm-delta";
  }
  if (confidence === "high") {
    return "answer-from-memory";
  }
  if (confidence === "none") {
    return "run-fact-query";
  }
  return "continue-workflow";
}

function executiveFacts(summary: ExecutiveSummaryResult | undefined, query: string): string[] {
  if (!summary) {
    return [];
  }

  const normalized = query.toLowerCase();
  const candidates = [
    `Project type: ${summary.identity.projectType}`,
    summary.stack.languages.length > 0 ? `Languages: ${summary.stack.languages.join(", ")}` : undefined,
    summary.stack.frameworks.length > 0 ? `Frameworks: ${summary.stack.frameworks.join(", ")}` : undefined,
    `Scopes: total=${summary.status.scopeCount}, freshComplete=${summary.status.completeFreshScopes}, stale=${summary.status.staleScopes}`,
    summary.status.latestSwarmIntent ? `Latest swarm intent: ${summary.status.latestSwarmIntent}` : undefined,
    summary.status.latestSwarmHeadline ? `Latest swarm headline: ${summary.status.latestSwarmHeadline}` : undefined
  ].filter((item): item is string => Boolean(item));

  return candidates.filter((candidate) =>
    candidate
      .toLowerCase()
      .split(/[^a-z0-9_.:/-]+/i)
      .some((token) => token.length > 2 && normalized.includes(token))
  );
}

export async function preflightFacts(
  context: ProjectContext,
  intent: string,
  options: PreflightFactsOptions = {}
): Promise<PreflightFactsResult> {
  const maxFacts = options.maxFacts ?? 12;
  const query = intent;
  const factQuery = await collectFactQuery(context, query);
  const executiveSummaryPath = path.join(context.memoryDir, "EXECUTIVE_SUMMARY.md");
  const executiveSummaryJsonPath = path.join(context.runtimeMemoryDir, "executive_summary", "executive_summary.json");
  const executiveSummary = await readJsonSafe<ExecutiveSummaryResult>(executiveSummaryJsonPath);
  const scopeRecords = await listScopeMemoryRecords(context);
  const requestedScopes = options.scopePaths?.length ? new Set(options.scopePaths) : undefined;
  const scopedRecords = requestedScopes
    ? scopeRecords.filter((record) => requestedScopes.has(record.scope))
    : scopeRecords;
  const freshScopes = scopedRecords.filter((record) => record.freshness.status === "fresh").map((record) => record.scope);
  const staleScopes = scopedRecords.filter((record) => record.freshness.status === "stale").map((record) => record.scope);
  const missingScopes = options.scopePaths?.filter((scope) => !scopeRecords.some((record) => record.scope === scope)) ?? [];
  const execFacts = executiveFacts(executiveSummary, query);
  const facts = uniqueSorted([
    ...factQuery.memoryMatches.map((match) => `${match.kind}: ${match.text}`),
    ...(factQuery.scopeMemoryMatches ?? []).map((match) => `${match.scope}/${match.kind}: ${match.text}`),
    ...factQuery.nodeMatches.map((match) => `${match.kind}: ${match.label}`),
    ...factQuery.edgeMatches.map((match) => `${match.kind}: ${match.from} -> ${match.to}`),
    ...execFacts
  ]).slice(0, maxFacts);
  const hasFactGraph = await fileExists(factQuery.sources.repositoryFactGraphPath);
  const hasMemoryBrief = await fileExists(factQuery.sources.memoryBriefJsonPath);
  const hasExecutiveSummary = await fileExists(executiveSummaryJsonPath);
  const confidence = confidenceFor({
    memoryMatches: factQuery.memoryMatches,
    scopeMemoryMatches: factQuery.scopeMemoryMatches,
    nodeMatches: factQuery.nodeMatches,
    edgeMatches: factQuery.edgeMatches,
    executiveFacts: execFacts
  });

  return {
    intent,
    scope: options.scope,
    query,
    factsFound: facts.length > 0,
    facts,
    evidence: factQuery.evidenceRefs,
    freshness: {
      freshScopes,
      staleScopes,
      missingScopes
    },
    staleIgnored: factQuery.unknowns.filter((unknown) => /Scope memory .* stale/i.test(unknown)),
    confidence,
    recommendedNextAction: nextActionFor(confidence, hasFactGraph, staleScopes),
    readiness: {
      hasMemoryBrief,
      hasExecutiveSummary,
      hasFactGraph,
      hasFreshScopeMemory: freshScopes.length > 0
    },
    sources: {
      memoryBriefPath: factQuery.sources.memoryBriefPath,
      memoryBriefJsonPath: factQuery.sources.memoryBriefJsonPath,
      executiveSummaryPath,
      executiveSummaryJsonPath,
      repositoryFactGraphPath: factQuery.sources.repositoryFactGraphPath,
      scopeMemoryDir: factQuery.sources.scopeMemoryDir ?? path.join(context.runtimeMemoryDir, "scopes")
    },
    unknowns: factQuery.unknowns
  };
}
