import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDir, uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { EcosystemRepositoryResult, RiskLevel } from "../../shared/types";

interface PatternRecord {
  pattern: string;
  repositories: string[];
  count: number;
  sources?: string[];
}

interface ReusableImprovementProposal {
  title: string;
  description: string;
  repositories: string[];
  riskLevel: RiskLevel;
  expectedBenefit: string;
  implementationSketch: string;
  confidence: number;
}

export interface KnowledgeGraphDocument {
  generatedAt: string;
  repositories: Array<{
    repo: string;
    relativePath: string;
    languages: string[];
    frameworks: string[];
    highestRisk: RiskLevel;
    proposalsGenerated: number;
  }>;
  architecturePatterns: PatternRecord[];
  repeatedBugs: PatternRecord[];
  reusableModules: PatternRecord[];
  performancePatterns: PatternRecord[];
  reusableImprovements: ReusableImprovementProposal[];
}

function listOrNone(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function highestRiskFor(result: EcosystemRepositoryResult): RiskLevel {
  if (result.result.agentReports.some((report) => report.riskLevel === "high")) {
    return "high";
  }
  if (result.result.agentReports.some((report) => report.riskLevel === "medium")) {
    return "medium";
  }
  return "low";
}

function normalizePattern(value: string): string {
  const lower = value.toLowerCase();

  if (/no automated test framework|untested|test files|test-to-source ratio|coverage/i.test(value)) {
    return "missing automated test baseline";
  }
  if (/ci\/cd|ci pipeline|ci baseline|quality gates/i.test(value)) {
    return "missing ci baseline";
  }
  if (/structured logging|lack of logging|logging/i.test(value)) {
    return "limited structured logging";
  }
  if (/metrics|tracing|alerts/i.test(value)) {
    return "limited runtime telemetry";
  }
  if (/openapi|api contract/i.test(value)) {
    return "missing api contract";
  }
  if (/circular dependenc/i.test(value)) {
    return "circular dependency risk";
  }
  if (/unused export/i.test(value)) {
    return "unused exported symbols";
  }
  if (/large files|over 500 lines|oversized/i.test(value)) {
    return "oversized modules";
  }
  if (/coupling|architectural drift|complexity/i.test(value)) {
    return "architectural coupling drift";
  }
  if (/performance|latency|cpu|memory|query|dependency bloat|hotspot/i.test(value)) {
    return "performance hotspot pattern";
  }

  return lower.replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function architecturePatternFor(result: EcosystemRepositoryResult): string {
  const languages = result.result.context.discovery.languages.join("+") || "Unknown";
  const frameworks = result.result.context.discovery.frameworks.join("+") || "NoFramework";
  return `${languages} :: ${frameworks}`;
}

function collectPatternRecords(
  entries: Array<{ pattern: string; repo: string; source?: string }>,
  minimumCount = 2
): PatternRecord[] {
  const grouped = new Map<string, { repositories: Set<string>; sources: Set<string> }>();

  for (const entry of entries) {
    const normalized = normalizePattern(entry.pattern);

    if (!normalized) {
      continue;
    }

    const current = grouped.get(normalized) ?? {
      repositories: new Set<string>(),
      sources: new Set<string>()
    };
    current.repositories.add(entry.repo);
    if (entry.source) {
      current.sources.add(entry.source);
    }
    grouped.set(normalized, current);
  }

  return [...grouped.entries()]
    .map(([pattern, value]) => ({
      pattern,
      repositories: uniqueSorted([...value.repositories]),
      count: value.repositories.size,
      sources: value.sources.size > 0 ? uniqueSorted([...value.sources]) : undefined
    }))
    .filter((record) => record.count >= minimumCount)
    .sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern));
}

function collectReusableModules(results: EcosystemRepositoryResult[]): PatternRecord[] {
  const entries = results.flatMap((result) =>
    result.result.context.discovery.structure.topLevelDirectories.map((moduleName) => ({
      pattern: moduleName,
      repo: result.repoName
    }))
  );

  return collectPatternRecords(entries)
    .filter((record) => !["src", "tests", "test", "docs", "dist", "build"].includes(record.pattern))
    .slice(0, 10);
}

function collectPerformancePatterns(results: EcosystemRepositoryResult[]): PatternRecord[] {
  return collectPatternRecords(
    results.flatMap((result) =>
      result.result.agentReports
        .filter((report) => ["optimization-agent", "dev-agent", "observability-agent"].includes(report.agentId))
        .flatMap((report) =>
          [...report.findings, ...report.recommendations].map((entry) => ({
            pattern: entry,
            repo: result.repoName,
            source: report.agentId
          }))
        )
    )
  );
}

function reusableImprovementDescription(pattern: PatternRecord): {
  title: string;
  description: string;
  riskLevel: RiskLevel;
  expectedBenefit: string;
  implementationSketch: string;
  confidence: number;
} {
  if (pattern.pattern === "missing automated test baseline") {
    return {
      title: "Standardize a shared test baseline across repositories",
      description: "Multiple repositories are evolving without an automated test foundation. Standardizing a common smoke and unit-test baseline reduces regression risk across the ecosystem.",
      riskLevel: "high",
      expectedBenefit: "Raises delivery safety before cross-project autonomous proposals scale further.",
      implementationSketch: "Create a shared test template, add smoke coverage for CLI and runtime flows, and wire the baseline into CI for each repository.",
      confidence: 0.93
    };
  }
  if (pattern.pattern === "missing ci baseline") {
    return {
      title: "Roll out a reusable CI quality gate",
      description: "The ecosystem shows repeated CI gaps. A shared workflow template would enforce build, typecheck, tests, and smoke checks consistently.",
      riskLevel: "high",
      expectedBenefit: "Makes proposal review safer and reduces repository-specific drift in quality gates.",
      implementationSketch: "Publish a standard GitHub Actions workflow and adapt only repository-specific install/build/test commands where needed.",
      confidence: 0.9
    };
  }
  if (pattern.pattern === "limited structured logging" || pattern.pattern === "limited runtime telemetry") {
    return {
      title: "Standardize observability primitives across repositories",
      description: "Runtime diagnostics are inconsistent across multiple repositories. Shared logging and telemetry conventions would improve incident response and cross-project learning.",
      riskLevel: "medium",
      expectedBenefit: "Improves traceability, debugging, and reusable operational knowledge.",
      implementationSketch: "Adopt a common structured logger and lightweight cycle telemetry schema, then add repository-specific adapters only where needed.",
      confidence: 0.84
    };
  }

  return {
    title: `Reusable improvement for ${pattern.pattern}`,
    description: `The pattern "${pattern.pattern}" appears across multiple repositories and should be treated as a reusable improvement opportunity rather than a one-off fix.`,
    riskLevel: pattern.pattern.includes("security") ? "high" : "medium",
    expectedBenefit: "Reduces duplicated remediation effort across the ecosystem.",
    implementationSketch: "Create a shared guideline or reusable package, then roll it out repository by repository with human approval.",
    confidence: 0.78
  };
}

function buildReusableImprovements(
  repeatedBugs: PatternRecord[],
  performancePatterns: PatternRecord[]
): ReusableImprovementProposal[] {
  const deduped = new Map<string, ReusableImprovementProposal>();

  for (const pattern of [...repeatedBugs, ...performancePatterns]) {
    const template = reusableImprovementDescription(pattern);
    const existing = deduped.get(template.title);

    if (!existing) {
      deduped.set(template.title, {
        ...template,
        repositories: pattern.repositories
      });
      continue;
    }

    deduped.set(template.title, {
      ...existing,
      repositories: uniqueSorted([...existing.repositories, ...pattern.repositories]),
      confidence: Math.max(existing.confidence, template.confidence)
    });
  }

  return [...deduped.values()].slice(0, 6);
}

function proposalFileName(index: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `proposal_ecosystem_${String(index).padStart(2, "0")}_${slug}.md`;
}

async function clearPreviousEcosystemProposals(proposalDir: string): Promise<void> {
  try {
    const files = await fs.readdir(proposalDir);
    await Promise.all(
      files
        .filter((fileName) => fileName.startsWith("proposal_ecosystem_") && fileName.endsWith(".md"))
        .map((fileName) => fs.rm(path.join(proposalDir, fileName), { force: true }))
    );
  } catch {
    // ignore missing directory
  }
}

export async function buildKnowledgeGraphArtifacts(
  outputPath: string,
  results: EcosystemRepositoryResult[]
): Promise<{
  knowledgeGraphPath: string;
  proposalPaths: string[];
  ecosystemReportPath: string;
}> {
  const knowledgeGraphDir = path.join(outputPath, "memory", "knowledge_graph");
  const proposalDir = path.join(outputPath, "docs", "proposals");
  const reportPath = path.join(outputPath, "reports", "ecosystem_health.md");

  await ensureDir(knowledgeGraphDir);
  await ensureDir(proposalDir);
  await ensureDir(path.dirname(reportPath));
  await clearPreviousEcosystemProposals(proposalDir);

  const architecturePatterns = collectPatternRecords(
    results.map((result) => ({
      pattern: architecturePatternFor(result),
      repo: result.repoName
    })),
    1
  );
  const repeatedBugs = collectPatternRecords(
    results.flatMap((result) =>
      result.result.agentReports.flatMap((report) =>
        [...report.findings, ...result.result.context.discovery.recommendations].map((entry) => ({
          pattern: entry,
          repo: result.repoName,
          source: report.agentId
        }))
      )
    )
  );
  const reusableModules = collectReusableModules(results);
  const performancePatterns = collectPerformancePatterns(results);
  const reusableImprovements = buildReusableImprovements(repeatedBugs, performancePatterns);

  const knowledgeGraph: KnowledgeGraphDocument = {
    generatedAt: new Date().toISOString(),
    repositories: results.map((result) => ({
      repo: result.repoName,
      relativePath: result.relativePath,
      languages: result.result.context.discovery.languages,
      frameworks: result.result.context.discovery.frameworks,
      highestRisk: highestRiskFor(result),
      proposalsGenerated: result.result.governanceSummary?.proposals.length ?? 0
    })),
    architecturePatterns,
    repeatedBugs,
    reusableModules,
    performancePatterns,
    reusableImprovements
  };

  const knowledgeGraphPath = path.join(knowledgeGraphDir, "knowledge_graph.json");
  await writeJsonEnsured(knowledgeGraphPath, knowledgeGraph);

  const proposalPaths: string[] = [];
  for (const [index, proposal] of reusableImprovements.entries()) {
    const filePath = path.join(proposalDir, proposalFileName(index + 1, proposal.title));
    const content = `# ${proposal.title}

## Description

${proposal.description}

## Repositories

${listOrNone(proposal.repositories)}

## Risk Level

- ${proposal.riskLevel}

## Expected Benefit

${proposal.expectedBenefit}

## Implementation Sketch

${proposal.implementationSketch}

## Confidence

- ${proposal.confidence}
`;
    await writeFileEnsured(filePath, content);
    proposalPaths.push(filePath);
  }

  const dominantArchitecture =
    architecturePatterns.length > 0 && architecturePatterns[0]?.count !== 1
      ? architecturePatterns[0].pattern
      : "No dominant pattern detected";
  const architectureDrift = architecturePatterns
    .filter((pattern) => dominantArchitecture === "No dominant pattern detected" || pattern.pattern !== dominantArchitecture)
    .slice(0, 5)
    .map((pattern) => `${pattern.pattern} -> ${pattern.repositories.join(", ")}`);

  const reportContent = `# Ecosystem Health

## Repository Health

${results
  .map((result) => {
    const discovery = result.result.context.discovery;
    return `### ${result.repoName}

- Path: ${result.relativePath}
- Highest risk: ${highestRiskFor(result)}
- Languages: ${discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}
- Proposals generated: ${result.result.governanceSummary?.proposals.length ?? 0}`;
  })
  .join("\n\n")}

## Repeated Risks

${listOrNone(
  repeatedBugs.slice(0, 10).map((pattern) => `${pattern.pattern} -> ${pattern.repositories.join(", ")}`)
)}

## Architecture Drift

- Dominant architecture pattern: ${dominantArchitecture}
${architectureDrift.length > 0 ? architectureDrift.map((entry) => `- Divergent stack: ${entry}`).join("\n") : "- No material architecture drift detected across the analyzed repositories."}

## Improvement Opportunities

${listOrNone(
  reusableImprovements.map(
    (proposal) => `${proposal.title} -> ${proposal.repositories.join(", ")} | confidence=${proposal.confidence}`
  )
)}
`;

  await writeFileEnsured(reportPath, reportContent);

  return {
    knowledgeGraphPath,
    proposalPaths,
    ecosystemReportPath: reportPath
  };
}
