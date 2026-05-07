import path from "node:path";

import { readJsonSafe, uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  FactQueryResult,
  ProjectContext,
  RepositoryFactGraphDocument,
  RepositoryFactGraphEdge,
  RepositoryFactGraphNode,
  ScopeMemoryRecord
} from "../../shared/types";
import type { MemoryBriefDocument } from "../memory_brief";
import { listScopeMemoryRecords } from "../scope_store";

interface ScoredMatch<T> {
  item: T;
  score: number;
  text: string;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "como",
  "para",
  "con",
  "los",
  "las",
  "una",
  "uno",
  "que",
  "del",
  "por",
  "sin"
]);

function tokenize(input: string): string[] {
  return uniqueSorted(
    input
      .toLowerCase()
      .split(/[^a-z0-9_.:/-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
  );
}

function scoreText(text: string, tokens: string[]): number {
  const normalized = text.toLowerCase();
  return tokens.reduce((score, token) => {
    if (normalized === token) {
      return score + 8;
    }
    if (normalized.includes(`/${token}`) || normalized.includes(`${token}/`)) {
      return score + 5;
    }
    if (normalized.includes(token)) {
      return score + 3;
    }
    return score;
  }, 0);
}

function topMatches<T>(items: T[], tokens: string[], textFor: (item: T) => string, limit: number): ScoredMatch<T>[] {
  return items
    .map((item) => {
      const text = textFor(item);
      return {
        item,
        text,
        score: scoreText(text, tokens)
      };
    })
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.text.localeCompare(right.text))
    .slice(0, limit);
}

function memoryLines(brief: MemoryBriefDocument | undefined): string[] {
  if (!brief) {
    return [];
  }

  return [
    ...brief.decisions.map((entry) => `decision: ${entry}`),
    ...brief.learnings.map((entry) => `learning: ${entry}`),
    ...brief.corrections.map((entry) => `correction: ${entry}`),
    ...brief.annotations.map((entry) => `annotation: ${entry}`),
    ...brief.repeatedPatterns.map((entry) => `repeated-pattern: ${entry}`),
    ...brief.recentVerifiedFacts.map((entry) => `verified-fact: ${entry}`),
    ...brief.recentUnknowns.map((entry) => `unknown: ${entry}`),
    ...brief.evidenceRefs.map((entry) => `evidence: ${entry}`),
    ...brief.nextBestActions.map((entry) => `next-action: ${entry}`)
  ];
}

function scopeMemoryLines(record: ScopeMemoryRecord): string[] {
  return [
    ...record.decisions.map((entry) => `decision: ${entry}`),
    ...record.verifiedFacts.map((entry) => `verified-fact: ${entry}`),
    ...record.unknowns.map((entry) => `unknown: ${entry}`),
    ...record.evidenceRefs.map((entry) => `evidence: ${entry}`),
    ...record.nextActions.map((entry) => `next-action: ${entry}`)
  ];
}

function nodeText(node: RepositoryFactGraphNode): string {
  return `${node.kind} ${node.id} ${node.label} ${JSON.stringify(node.attributes ?? {})}`;
}

function edgeText(edge: RepositoryFactGraphEdge): string {
  return `${edge.kind} ${edge.from} ${edge.to} ${edge.evidencePath ?? ""} ${edge.line ?? ""}`;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderFactQueryReport(result: FactQueryResult): string {
  return `# Fact Query

## Query

- Text: ${result.query}
- Answer: ${result.answer}
- Tokens: ${result.tokens.join(", ") || "None"}
- Memory brief: ${result.sources.memoryBriefPath}
- Repository fact graph: ${result.sources.repositoryFactGraphPath}
- Scope memory: ${result.sources.scopeMemoryDir ?? "None"}

## Summary

- Memory matches: ${result.memoryMatches.length}
- Node matches: ${result.nodeMatches.length}
- Edge matches: ${result.edgeMatches.length}
- Scope memory matches: ${result.scopeMemoryMatches?.length ?? 0}
- Evidence refs: ${result.evidenceRefs.length}

## Memory Matches

${renderList(result.memoryMatches.map((match) => `${match.kind}: ${match.text}`))}

## Node Matches

${renderList(result.nodeMatches.map((match) => `${match.kind}: ${match.label} (${match.id})`))}

## Edge Matches

${renderList(result.edgeMatches.map((match) => `${match.kind}: ${match.from} -> ${match.to}${match.evidencePath ? ` | ${match.evidencePath}` : ""}`))}

## Scope Memory Matches

${renderList((result.scopeMemoryMatches ?? []).map((match) => `${match.scope} | ${match.kind}: ${match.text}`))}

## Evidence Refs

${renderList(result.evidenceRefs)}

## Unknowns

${renderList(result.unknowns)}
`;
}

function buildAnswer(
  memoryMatches: FactQueryResult["memoryMatches"],
  scopeMemoryMatches: NonNullable<FactQueryResult["scopeMemoryMatches"]>,
  nodeMatches: FactQueryResult["nodeMatches"],
  edgeMatches: FactQueryResult["edgeMatches"]
): string {
  if (memoryMatches.length === 0 && scopeMemoryMatches.length === 0 && nodeMatches.length === 0 && edgeMatches.length === 0) {
    return "UNKNOWN";
  }

  const parts = [
    memoryMatches[0] ? `memory=${memoryMatches[0].kind}: ${memoryMatches[0].text}` : undefined,
    scopeMemoryMatches[0]
      ? `scope-memory=${scopeMemoryMatches[0].scope}/${scopeMemoryMatches[0].kind}: ${scopeMemoryMatches[0].text}`
      : undefined,
    nodeMatches[0] ? `node=${nodeMatches[0].kind}: ${nodeMatches[0].label}` : undefined,
    edgeMatches[0] ? `edge=${edgeMatches[0].kind}: ${edgeMatches[0].from} -> ${edgeMatches[0].to}` : undefined
  ].filter((part): part is string => Boolean(part));

  return `FOUND: ${parts.join(" | ")}`;
}

export async function runFactQuery(context: ProjectContext, query: string): Promise<FactQueryResult> {
  const tokens = tokenize(query);
  const memoryBriefPath = path.join(context.memoryDir, "MEMORY_BRIEF.md");
  const memoryBriefJsonPath = path.join(context.runtimeMemoryDir, "memory_brief", "memory_brief.json");
  const repositoryFactGraphPath = path.join(context.runtimeMemoryDir, "knowledge_graph", "repository_fact_graph.json");
  const scopeMemoryDir = path.join(context.runtimeMemoryDir, "scopes");
  const reportPath = path.join(context.reportsDir, "fact_query.md");
  const memoryPath = path.join(context.memoryDir, "fact_query", "fact_query.json");
  const brief = await readJsonSafe<MemoryBriefDocument>(memoryBriefJsonPath);
  const graph = await readJsonSafe<RepositoryFactGraphDocument>(repositoryFactGraphPath);
  const scopeRecords = await listScopeMemoryRecords(context);
  const freshScopeRecords = scopeRecords.filter((record) => record.freshness.status === "fresh");
  const memoryMatches = topMatches(memoryLines(brief), tokens, (line) => line, 12).map((match) => {
    const [kind, ...rest] = match.item.split(": ");
    return {
      kind: kind || "memory",
      text: rest.join(": ") || match.item,
      score: match.score
    };
  });
  const nodeMatches = topMatches(graph?.nodes ?? [], tokens, nodeText, 16).map((match) => ({
    id: match.item.id,
    kind: match.item.kind,
    label: match.item.label,
    score: match.score,
    attributes: match.item.attributes
  }));
  const edgeMatches = topMatches(graph?.edges ?? [], tokens, edgeText, 16).map((match) => ({
    kind: match.item.kind,
    from: match.item.from,
    to: match.item.to,
    evidencePath: match.item.evidencePath,
    line: match.item.line,
    score: match.score
  }));
  const scopeMemoryMatches = freshScopeRecords
    .flatMap((record) =>
      topMatches(scopeMemoryLines(record), tokens, (line) => line, 8).map((match) => {
        const [kind, ...rest] = match.item.split(": ");
        return {
          scope: record.scope,
          kind: kind || "scope-memory",
          text: rest.join(": ") || match.item,
          score: match.score,
          evidenceRefs: record.evidenceRefs
        };
      })
    )
    .sort((left, right) => right.score - left.score || left.scope.localeCompare(right.scope))
    .slice(0, 12);
  const evidenceRefs = uniqueSorted([
    ...memoryMatches.filter((match) => match.kind === "evidence").map((match) => match.text),
    ...scopeMemoryMatches.flatMap((match) => match.evidenceRefs),
    ...nodeMatches.map((match) => String(match.attributes?.filePath ?? "")).filter(Boolean),
    ...edgeMatches.map((match) => match.evidencePath ?? "").filter(Boolean)
  ]).slice(0, 20);
  const unknowns = [
    ...(brief?.recentUnknowns ?? []),
    ...scopeRecords
      .filter((record) => record.freshness.status === "stale")
      .map((record) => `Scope memory for ${record.scope} is stale; rerun swarm for that scope before treating it as factual.`),
    ...(graph ? [] : ["repository_fact_graph.json is missing; run project-brain code-graph first."]),
    ...(brief ? [] : ["memory_brief.json is missing; run project-brain status first."])
  ];
  const result: FactQueryResult = {
    query,
    answer: buildAnswer(memoryMatches, scopeMemoryMatches, nodeMatches, edgeMatches),
    tokens,
    reportPath,
    memoryPath,
    sources: {
      memoryBriefPath,
      memoryBriefJsonPath,
      repositoryFactGraphPath,
      scopeMemoryDir
    },
    scopeMemoryMatches,
    memoryMatches,
    nodeMatches,
    edgeMatches,
    evidenceRefs,
    unknowns: uniqueSorted(unknowns).slice(0, 12)
  };

  await writeJsonEnsured(memoryPath, result);
  await writeFileEnsured(reportPath, renderFactQueryReport(result));
  return result;
}
