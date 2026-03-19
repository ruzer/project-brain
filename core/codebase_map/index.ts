import path from "node:path";

import { listContextAnnotations } from "../../memory/annotations";
import { ensureDir, writeFileEnsured } from "../../shared/fs-utils";
import type { CodebaseMapArtifact, ContextAnnotation, DiscoveryResult, ProjectContext } from "../../shared/types";

type ConcernSeverity = "high" | "medium" | "low";

interface ConcernSignal {
  severity: ConcernSeverity;
  title: string;
  detail: string;
}

const TEST_FILE_PATTERN = /(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i;
const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|py|go|java|rs|cs|rb|php)$/i;
const CONFIG_FILE_PATTERN =
  /(^|\/)(package(-lock)?\.json|tsconfig\.json|vitest\.config\.[a-z]+|jest\.config\.[a-z]+|requirements\.txt|go\.mod|pom\.xml|Cargo\.toml|Gemfile|composer\.json|Dockerfile|docker-compose\.(ya?ml)|\.github\/workflows\/.+|eslint.*|prettier.*|\.editorconfig)$/i;

function analysisDate(scannedAt: string): string {
  return scannedAt.split("T")[0] ?? scannedAt;
}

function renderList(items: string[], formatter?: (item: string) => string): string {
  if (items.length === 0) {
    return "- None detected";
  }

  return items.map((item) => (formatter ? formatter(item) : `- ${item}`)).join("\n");
}

function renderFileList(files: string[]): string {
  return renderList(files, (file) => `- \`${file}\``);
}

function renderConcernList(concerns: ConcernSignal[]): string {
  return concerns
    .map(
      (concern) =>
        `### ${concern.severity.toUpperCase()}: ${concern.title}\n\n${concern.detail}`
    )
    .join("\n\n");
}

function renderAnnotations(annotations: ContextAnnotation[]): string {
  if (annotations.length === 0) {
    return "- None recorded";
  }

  return annotations
    .map(
      (annotation) =>
        `- ${annotation.scope}: ${annotation.note} (updated ${annotation.updatedAt})`
    )
    .join("\n");
}

function inferProjectShape(discovery: DiscoveryResult): string {
  const frameworks = new Set(discovery.frameworks);
  const infrastructure = new Set(discovery.infrastructure);

  if (frameworks.has("NextJS") && frameworks.has("NestJS")) {
    return "Full-stack web platform";
  }

  if (frameworks.has("React") || frameworks.has("NextJS")) {
    return "Frontend-oriented application";
  }

  if (frameworks.has("Express") || frameworks.has("FastAPI") || frameworks.has("Spring") || frameworks.has("Rails")) {
    return "Backend/API service";
  }

  if (infrastructure.has("Terraform") || infrastructure.has("Kubernetes")) {
    return "Infrastructure-oriented repository";
  }

  if (discovery.languages.length > 2) {
    return "Polyglot software platform";
  }

  return "General software repository";
}

function sampleSourceFiles(discovery: DiscoveryResult, limit = 8): string[] {
  return discovery.files.filter((file) => SOURCE_FILE_PATTERN.test(file)).slice(0, limit);
}

function sampleTestFiles(discovery: DiscoveryResult, limit = 8): string[] {
  return discovery.files.filter((file) => TEST_FILE_PATTERN.test(file)).slice(0, limit);
}

function configFiles(discovery: DiscoveryResult, limit = 12): string[] {
  return discovery.files.filter((file) => CONFIG_FILE_PATTERN.test(file)).slice(0, limit);
}

function packageManagers(discovery: DiscoveryResult): string[] {
  const managers: string[] = [];

  if (discovery.files.includes("package-lock.json")) {
    managers.push("npm (`package-lock.json`)");
  }
  if (discovery.files.includes("yarn.lock")) {
    managers.push("Yarn (`yarn.lock`)");
  }
  if (discovery.files.includes("pnpm-lock.yaml")) {
    managers.push("pnpm (`pnpm-lock.yaml`)");
  }
  if (discovery.files.includes("requirements.txt")) {
    managers.push("pip (`requirements.txt`)");
  }
  if (discovery.files.includes("go.mod")) {
    managers.push("Go modules (`go.mod`)");
  }
  if (discovery.files.includes("Cargo.toml")) {
    managers.push("Cargo (`Cargo.toml`)");
  }
  if (discovery.files.includes("Gemfile")) {
    managers.push("Bundler (`Gemfile`)");
  }

  return managers;
}

function highlightDependencies(discovery: DiscoveryResult, limit = 10): string[] {
  const seen = new Set<string>();
  const highlights: string[] = [];

  for (const manifest of discovery.dependencies) {
    for (const dependency of manifest.dependencies) {
      if (seen.has(dependency)) {
        continue;
      }

      seen.add(dependency);
      highlights.push(`${dependency} (${manifest.path})`);

      if (highlights.length >= limit) {
        return highlights;
      }
    }
  }

  return highlights;
}

function testingHealth(discovery: DiscoveryResult): string {
  if (discovery.testing.length === 0 || discovery.structure.testFileCount === 0) {
    return "No clear automated testing baseline was detected.";
  }

  const ratio =
    discovery.structure.sourceFileCount > 0
      ? discovery.structure.testFileCount / discovery.structure.sourceFileCount
      : 0;

  if (ratio < 0.15) {
    return "Tests exist, but coverage density looks light relative to the amount of source code.";
  }

  return "Testing signals look present and proportionate for a first-pass repository scan.";
}

function buildConcernSignals(discovery: DiscoveryResult): ConcernSignal[] {
  const concerns: ConcernSignal[] = [];

  if (discovery.ci.providers.length === 0) {
    concerns.push({
      severity: "high",
      title: "No CI pipeline detected",
      detail: "Automated validation does not appear to run on every change. That weakens confidence in proposals, refactors, and cross-repository governance."
    });
  }

  if (discovery.testing.length === 0 || discovery.structure.testFileCount === 0) {
    concerns.push({
      severity: "high",
      title: "Testing baseline is missing or opaque",
      detail: "The repository scan did not find a reliable automated test surface. Any future improvement plan should start by defining the minimum validation contract."
    });
  } else if (
    discovery.structure.sourceFileCount >= 20 &&
    discovery.structure.testFileCount / discovery.structure.sourceFileCount < 0.15
  ) {
    concerns.push({
      severity: "medium",
      title: "Test density looks thin",
      detail: `Only ${discovery.structure.testFileCount} test files were detected for ${discovery.structure.sourceFileCount} source files. That makes change safety uneven.`
    });
  }

  if (discovery.apis.includes("REST") && !discovery.apis.includes("OpenAPI")) {
    concerns.push({
      severity: "medium",
      title: "REST surface lacks a contract signal",
      detail: "REST-style APIs were detected without an OpenAPI or Swagger contract. That raises onboarding cost and weakens downstream agent context."
    });
  }

  if (!discovery.logging.structured) {
    concerns.push({
      severity: "medium",
      title: "Structured logging was not detected",
      detail: "Operational analysis and incident reconstruction become harder when logs are ad hoc or absent."
    });
  }

  if (discovery.metrics.tools.length === 0) {
    concerns.push({
      severity: "medium",
      title: "Metrics and tracing signals are absent",
      detail: "The scan did not find metrics tooling or alerting configuration. Reliability and performance proposals will have weaker production feedback loops."
    });
  }

  if (discovery.structure.subrepos.length > 0 || discovery.structure.submodules.length > 0) {
    concerns.push({
      severity: "medium",
      title: "Repository boundaries are non-trivial",
      detail: "Nested repositories or git submodules were detected. Governance, ownership, and change planning should treat these boundaries explicitly."
    });
  }

  if (discovery.languages.length > 2) {
    concerns.push({
      severity: "low",
      title: "Polyglot surface increases coordination cost",
      detail: `Multiple languages were detected (${discovery.languages.join(", ")}). Improvement workflows should keep artifacts and validation commands language-aware.`
    });
  }

  if (concerns.length === 0) {
    concerns.push({
      severity: "low",
      title: "No critical structural gaps detected by first-pass heuristics",
      detail: "The repository still benefits from deeper agent analysis, but the deterministic map did not surface obvious execution blockers."
    });
  }

  return concerns;
}

function buildSummary(context: ProjectContext, annotations: ContextAnnotation[]): string {
  const discovery = context.discovery;
  const concerns = buildConcernSignals(discovery).slice(0, 3);

  return `# Codebase Map Summary

**Repository:** ${context.repoName}
**Analysis Date:** ${analysisDate(discovery.scannedAt)}
**Repository Type:** ${inferProjectShape(discovery)}

## Snapshot

- Languages: ${discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${discovery.frameworks.join(", ") || "Not detected"}
- API styles: ${discovery.apis.join(", ") || "Not detected"}
- Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}
- Test frameworks: ${discovery.testing.join(", ") || "Not detected"}
- CI providers: ${discovery.ci.providers.join(", ") || "Not detected"}
- Source files: ${discovery.structure.sourceFileCount}
- Test files: ${discovery.structure.testFileCount}

## Documents

- \`STACK.md\` for runtime, dependencies, and configuration
- \`INTEGRATIONS.md\` for external surfaces and operational hooks
- \`ARCHITECTURE.md\` for system shape and boundaries
- \`STRUCTURE.md\` for layout and key file locations
- \`CONVENTIONS.md\` for working norms inferred from the repo
- \`TESTING.md\` for validation posture and gaps
- \`CONCERNS.md\` for first-pass risks and follow-up priorities

## Immediate Concerns

${renderConcernList(concerns)}

## Local Notes

${renderAnnotations(annotations)}

## Recommended Next Steps

1. Run \`project-brain analyze ${context.targetPath} --output ${context.outputPath}\` to generate specialist-agent reports and proposals.
2. Review \`CONCERNS.md\` first, then \`TESTING.md\`, before acting on deeper architectural changes.
3. Keep generated artifacts in a dedicated output directory when analyzing external repositories to avoid polluting future scans.
`;
}

function buildStack(discovery: DiscoveryResult): string {
  return `# Technology Stack

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## Languages

${renderList(discovery.languages)}

## Runtime and Package Management

${renderList(packageManagers(discovery))}

## Frameworks

${renderList(discovery.frameworks)}

## Testing Tooling

${renderList(discovery.testing)}

## Dependency Highlights

${renderList(highlightDependencies(discovery))}

## Configuration Files

${renderFileList(configFiles(discovery))}
`;
}

function buildIntegrations(discovery: DiscoveryResult): string {
  return `# Integrations

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## API Surface

- Styles: ${discovery.apis.join(", ") || "Not detected"}
- API-related files:
${renderFileList(discovery.apiFiles)}

## Delivery and Infrastructure

- CI providers: ${discovery.ci.providers.join(", ") || "Not detected"}
- Infrastructure signals: ${discovery.infrastructure.join(", ") || "Not detected"}
- Infrastructure files:
${renderFileList(discovery.infraFiles)}

## Observability

- Logging frameworks: ${discovery.logging.frameworks.join(", ") || "Not detected"}
- Logging config files:
${renderFileList(discovery.logging.configFiles)}
- Metrics tooling: ${discovery.metrics.tools.join(", ") || "Not detected"}
- Metrics config files:
${renderFileList(discovery.metrics.configFiles)}
- Alerts configured: ${discovery.metrics.alertsConfigured ? "Yes" : "No signal detected"}

## Repository Integration

- Git repository: ${discovery.git.isGitRepo ? "Yes" : "No"}
- Active branch: ${discovery.git.branch ?? "Unknown"}
- Latest commit: ${discovery.git.latestCommit ?? "Unavailable"}
- Git submodules: ${discovery.git.hasSubmodules ? "Present" : "Not detected"}
`;
}

function buildArchitecture(discovery: DiscoveryResult): string {
  return `# Architecture

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## Inferred Shape

- Repository type: ${inferProjectShape(discovery)}
- Top-level directories: ${discovery.structure.topLevelDirectories.length}
- Nested repositories: ${discovery.structure.subrepos.length}
- Git submodules: ${discovery.structure.submodules.length}

## Primary Boundaries

${renderList(discovery.structure.topLevelDirectories, (directory) => `- \`${directory}/\``)}

## Runtime Signals

- Frameworks: ${discovery.frameworks.join(", ") || "Not detected"}
- API styles: ${discovery.apis.join(", ") || "Not detected"}
- Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}
- CI: ${discovery.ci.providers.join(", ") || "Not detected"}

## Source Entry Points

${renderFileList(sampleSourceFiles(discovery))}
`;
}

function buildStructure(discovery: DiscoveryResult): string {
  return `# Structure

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## Layout Overview

- Total files scanned: ${discovery.structure.fileCount}
- Source files: ${discovery.structure.sourceFileCount}
- Test files: ${discovery.structure.testFileCount}
- Dependency manifests: ${discovery.manifests.length}

## Key Directories

${renderList(discovery.structure.topLevelDirectories, (directory) => `- \`${directory}/\``)}

## Dependency Manifests

${renderFileList(discovery.manifests)}

## Representative Source Files

${renderFileList(sampleSourceFiles(discovery))}

## Representative Test Files

${renderFileList(sampleTestFiles(discovery))}
`;
}

function buildConventions(discovery: DiscoveryResult): string {
  const conventionSignals: string[] = [];

  if (discovery.files.some((file) => file.startsWith("src/"))) {
    conventionSignals.push("Application code is primarily organized under `src/`.");
  }
  if (discovery.files.some((file) => TEST_FILE_PATTERN.test(file))) {
    conventionSignals.push("Tests follow repository-local conventions such as `tests/`, `spec`, or `*.test.*` naming.");
  }
  if (discovery.files.some((file) => /eslint/i.test(file))) {
    conventionSignals.push("Linting configuration is present, which suggests enforceable code style expectations.");
  }
  if (discovery.files.includes("tsconfig.json")) {
    conventionSignals.push("TypeScript compiler configuration exists, so type-driven boundaries are part of the workflow.");
  }
  if (discovery.files.some((file) => file.startsWith("docs/")) || discovery.files.includes("README.md")) {
    conventionSignals.push("The repository maintains a documentation surface alongside code.");
  }
  if (conventionSignals.length === 0) {
    conventionSignals.push("No strong repository-wide conventions could be inferred from deterministic file and manifest analysis alone.");
  }

  return `# Conventions

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## Observed Working Conventions

${renderList(conventionSignals)}

## Configuration Signals

${renderFileList(configFiles(discovery))}

## Directory Signals

${renderList(discovery.structure.topLevelDirectories, (directory) => `- \`${directory}/\``)}

## Caveat

This document captures conventions that are visible from repository structure and configuration. Deep style rules, exception handling patterns, and naming nuances still require specialist-agent or human review.
`;
}

function buildTesting(discovery: DiscoveryResult): string {
  return `# Testing

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## Detected Test Tooling

${renderList(discovery.testing)}

## Test Surface

- Test files detected: ${discovery.structure.testFileCount}
- Source files detected: ${discovery.structure.sourceFileCount}
- Assessment: ${testingHealth(discovery)}

## Example Test Files

${renderFileList(sampleTestFiles(discovery))}

## Recommendations

${renderList(
  discovery.recommendations.filter((recommendation) => /test|validation|OpenAPI/i.test(recommendation))
)}
`;
}

function buildConcerns(discovery: DiscoveryResult): string {
  const concerns = buildConcernSignals(discovery);

  return `# Concerns

**Analysis Date:** ${analysisDate(discovery.scannedAt)}

## Prioritized Concerns

${renderConcernList(concerns)}

## Deterministic Recommendations

${renderList(discovery.recommendations)}
`;
}

export async function writeCodebaseMapArtifacts(context: ProjectContext): Promise<CodebaseMapArtifact> {
  const codebaseMapDir = path.join(context.docsDir, "codebase_map");
  await ensureDir(codebaseMapDir);
  const annotations = await listContextAnnotations(context.outputPath);

  const artifacts = new Map<string, string>([
    ["SUMMARY.md", buildSummary(context, annotations)],
    ["STACK.md", buildStack(context.discovery)],
    ["INTEGRATIONS.md", buildIntegrations(context.discovery)],
    ["ARCHITECTURE.md", buildArchitecture(context.discovery)],
    ["STRUCTURE.md", buildStructure(context.discovery)],
    ["CONVENTIONS.md", buildConventions(context.discovery)],
    ["TESTING.md", buildTesting(context.discovery)],
    ["CONCERNS.md", buildConcerns(context.discovery)]
  ]);

  await Promise.all(
    [...artifacts.entries()].map(async ([fileName, content]) => {
      await writeFileEnsured(path.join(codebaseMapDir, fileName), content);
    })
  );

  return {
    repoName: context.repoName,
    outputPath: context.outputPath,
    codebaseMapDir,
    files: [...artifacts.keys()].map((fileName) => path.join(codebaseMapDir, fileName)),
    summaryPath: path.join(codebaseMapDir, "SUMMARY.md")
  };
}
