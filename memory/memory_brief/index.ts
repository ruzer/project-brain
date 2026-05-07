import path from "node:path";

import { fileExists, readJsonSafe, readTextSafe, uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { LearningRecord, ProjectContext } from "../../shared/types";

interface SwarmMemoryShape {
  intent?: string;
  optimization?: {
    cacheHits?: number;
    cacheMisses?: number;
    cacheWrites?: number;
    learnedScopeBoosts?: string[];
  };
  synthesis?: {
    headline?: string;
    summary?: string;
    verified_facts?: string[];
    verifiedFacts?: string[];
    unknowns?: string[];
    evidence_refs?: string[];
    evidenceRefs?: string[];
    priorities?: string[];
    next_steps?: string[];
    nextSteps?: string[];
  };
}

export interface MemoryBriefDocument {
  version: 1;
  generatedAt: string;
  repoName: string;
  targetPath: string;
  outputPath: string;
  canonicalInputs: string[];
  decisions: string[];
  learnings: string[];
  corrections: string[];
  annotations: string[];
  repeatedPatterns: string[];
  recentVerifiedFacts: string[];
  recentUnknowns: string[];
  evidenceRefs: string[];
  nextBestActions: string[];
  tokenGuidance: string[];
}

function compactLines(input: string, limit: number): string[] {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) && !/none recorded|none detected/i.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean)
    .slice(-limit);
}

function normalizeList(items: Array<string | undefined>, limit: number): string[] {
  return uniqueSorted(
    items
      .filter((item): item is string => Boolean(item && item.trim()))
      .map((item) => item.trim())
  ).slice(0, limit);
}

function learningPatterns(records: LearningRecord[], limit: number): string[] {
  const counts = new Map<string, { count: number; agents: Set<string> }>();

  for (const record of records) {
    const key = record.detectedProblem.trim();
    if (!key) {
      continue;
    }

    const current = counts.get(key) ?? { count: 0, agents: new Set<string>() };
    current.count += 1;
    current.agents.add(record.agentId);
    counts.set(key, current);
  }

  return [...counts.entries()]
    .filter(([, value]) => value.count > 1)
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([problem, value]) => `${problem} (${value.count}x; agents=${[...value.agents].sort().join(", ")})`);
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function discoveryFacts(context: ProjectContext): string[] {
  const { discovery } = context;
  return normalizeList(
    [
      `Repository ${context.repoName} has ${discovery.structure.sourceFileCount} source files and ${discovery.structure.testFileCount} test files.`,
      discovery.languages.length > 0 ? `Languages: ${discovery.languages.join(", ")}.` : undefined,
      discovery.frameworks.length > 0 ? `Frameworks: ${discovery.frameworks.join(", ")}.` : undefined,
      discovery.apis.length > 0 ? `APIs: ${discovery.apis.join(", ")}.` : undefined,
      discovery.infrastructure.length > 0 ? `Infrastructure: ${discovery.infrastructure.join(", ")}.` : undefined,
      discovery.testing.length > 0 ? `Testing: ${discovery.testing.join(", ")}.` : undefined,
      discovery.ci.providers.length > 0 ? `CI/CD: ${discovery.ci.providers.join(", ")}.` : undefined,
      discovery.structure.topLevelDirectories.length > 0
        ? `Top-level directories: ${discovery.structure.topLevelDirectories.slice(0, 12).join(", ")}.`
        : undefined
    ],
    10
  );
}

function discoveryActions(context: ProjectContext): string[] {
  return normalizeList(context.discovery.recommendations, 6);
}

async function existingArtifacts(paths: string[]): Promise<string[]> {
  const pairs = await Promise.all(paths.map(async (artifactPath) => ({ artifactPath, exists: await fileExists(artifactPath) })));
  return pairs.filter((pair) => pair.exists).map((pair) => pair.artifactPath);
}

function renderMemoryBrief(brief: MemoryBriefDocument): string {
  return `# MEMORY_BRIEF

## Identity

- Repository: ${brief.repoName}
- Target: ${brief.targetPath}
- Output: ${brief.outputPath}
- Generated: ${brief.generatedAt}

## Canonical Inputs

${renderList(brief.canonicalInputs)}

## Decisions

${renderList(brief.decisions)}

## Learnings

${renderList(brief.learnings)}

## Corrections

${renderList(brief.corrections)}

## Annotations

${renderList(brief.annotations)}

## Repeated Patterns

${renderList(brief.repeatedPatterns)}

## Recent Verified Facts

${renderList(brief.recentVerifiedFacts)}

## Recent Unknowns

${renderList(brief.recentUnknowns)}

## Evidence Refs

${renderList(brief.evidenceRefs)}

## Next Best Actions

${renderList(brief.nextBestActions)}

## Token Guidance

${renderList(brief.tokenGuidance)}
`;
}

export async function writeMemoryBriefArtifacts(context: ProjectContext): Promise<MemoryBriefDocument> {
  const decisions = compactLines(await readTextSafe(path.join(context.memoryDir, "DECISIONS.md")), 8);
  const learnings = compactLines(await readTextSafe(path.join(context.memoryDir, "LEARNINGS.md")), 8);
  const corrections = compactLines(await readTextSafe(path.join(context.memoryDir, "ERRORS.md")), 8);
  const annotations = compactLines(await readTextSafe(path.join(context.memoryDir, "ANNOTATIONS.md")), 8);
  const learningRecords = (await readJsonSafe<LearningRecord[]>(path.join(context.learningDir, "index.json"))) ?? [];
  const swarmMemory = await readJsonSafe<SwarmMemoryShape>(path.join(context.memoryDir, "swarm", "swarm_run.json"));
  const synthesis = swarmMemory?.synthesis;
  const verifiedFacts = normalizeList([...(synthesis?.verified_facts ?? []), ...(synthesis?.verifiedFacts ?? [])], 10);
  const unknowns = normalizeList(synthesis?.unknowns ?? [], 8);
  const evidenceRefs = normalizeList([...(synthesis?.evidence_refs ?? []), ...(synthesis?.evidenceRefs ?? [])], 10);
  const nextSteps = normalizeList([...(synthesis?.next_steps ?? []), ...(synthesis?.nextSteps ?? []), ...(synthesis?.priorities ?? [])], 8);
  const runbookPath = path.join(context.reportsDir, "runbook.md");
  const harnessAuditPath = path.join(context.reportsDir, "harness_audit.md");
  const factQueryPath = path.join(context.reportsDir, "fact_query.md");
  const startPath = path.join(context.reportsDir, "start.md");
  const canonicalInputs = [
    path.join(context.memoryDir, "MEMORY_BRIEF.md"),
    path.join(context.memoryDir, "CONTEXT.md"),
    path.join(context.memoryDir, "PROJECT_MODEL.md"),
    path.join(context.memoryDir, "STACK_PROFILE.md"),
    path.join(context.runtimeMemoryDir, "knowledge_graph", "repository_fact_graph.json"),
    path.join(context.memoryDir, "swarm", "swarm_run.json"),
    factQueryPath,
    runbookPath,
    harnessAuditPath,
    startPath,
    path.join(context.memoryDir, "DECISIONS.md"),
    path.join(context.memoryDir, "LEARNINGS.md"),
    path.join(context.memoryDir, "ERRORS.md"),
    path.join(context.memoryDir, "ANNOTATIONS.md")
  ];
  const existingInputs = await existingArtifacts(canonicalInputs);

  const brief: MemoryBriefDocument = {
    version: 1,
    generatedAt: new Date().toISOString(),
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    canonicalInputs: existingInputs,
    decisions: decisions.length > 0 ? decisions : ["Adopt non-destructive analysis as the operating mode."],
    learnings,
    corrections,
    annotations,
    repeatedPatterns: learningPatterns(learningRecords, 8),
    recentVerifiedFacts: normalizeList([...discoveryFacts(context), ...verifiedFacts], 14),
    recentUnknowns: unknowns,
    evidenceRefs: normalizeList([...evidenceRefs, ...existingInputs], 14),
    nextBestActions: normalizeList([...nextSteps, ...discoveryActions(context)], 10),
    tokenGuidance: [
      "Read MEMORY_BRIEF before broad reports.",
      "Use repository_fact_graph.json for structural facts before asking a model.",
      "Use UNKNOWN instead of guessing missing relationships.",
      "Append new corrections, learnings, and decisions instead of duplicating whole reports.",
      "Prefer targeted scopes over full-repo swarm runs."
    ]
  };

  await writeJsonEnsured(path.join(context.runtimeMemoryDir, "memory_brief", "memory_brief.json"), brief);
  await writeFileEnsured(path.join(context.memoryDir, "MEMORY_BRIEF.md"), renderMemoryBrief(brief));

  return brief;
}
