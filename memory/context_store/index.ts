import { promises as fs } from "node:fs";
import path from "node:path";

import { appendFileEnsured, ensureDir, fileExists, readTextSafe, uniqueSorted, writeFileEnsured } from "../../shared/fs-utils";
import { StructuredLogger } from "../../shared/logger";
import type { AgentReport, DiscoveryResult, ProjectContext } from "../../shared/types";

const logger = new StructuredLogger("memory-store");

const DEFAULT_RULES = `# RULES

1. Never modify target code automatically without human approval.
2. Understand the repository before proposing changes.
3. Preserve project context and decisions across runs.
4. Record errors, corrections, and learnings in durable memory.
5. Generate documentation as a first-class artifact.
6. Keep recommendations stack-aware and portable.
`;

const DEFAULT_AGENT_ROSTER = `# AGENTS

## ChiefAgent

Coordinates the specialist agents and consolidates their reports.

## Specialist agents

- ProductAgent: UX, workflow friction, backlog opportunities
- QAAgent: testing depth, untested surfaces, likely defects
- SecurityAgent: secrets exposure, dependency hygiene, container hardening
- ObservabilityAgent: logs, metrics, alerting, operational readiness
- LegalAgent: license posture and compliance documentation gaps
- OptimizationAgent: performance, dependency bloat, runtime efficiency
- DocumentationAgent: architecture, API and runbook generation
- DevAgent: refactor and maintainability recommendations
`;

function listOrNone(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None detected";
}

function inferProjectType(discovery: DiscoveryResult): string {
  const frameworks = new Set(discovery.frameworks);
  const infra = new Set(discovery.infrastructure);

  if (frameworks.has("NestJS") && frameworks.has("NextJS")) {
    return "Full-stack platform";
  }

  if (frameworks.has("FastAPI") || frameworks.has("Express") || frameworks.has("Spring")) {
    return "Backend API service";
  }

  if (frameworks.has("NextJS") || frameworks.has("React")) {
    return "Frontend application";
  }

  if (infra.has("Terraform") || infra.has("Kubernetes")) {
    return "Infrastructure-oriented project";
  }

  if (discovery.languages.length > 2) {
    return "Polyglot software platform";
  }

  return "Software project";
}

function buildProjectModel(discovery: DiscoveryResult): string {
  return `# PROJECT_MODEL

Project: ${discovery.repoName}

Type:
${inferProjectType(discovery)}

Languages:
${discovery.languages.join(", ") || "Unknown"}

Frameworks:
${discovery.frameworks.join(", ") || "Unknown"}

APIs:
${discovery.apis.join(", ") || "Not detected"}

Testing:
${discovery.testing.join(", ") || "Not detected"}

Infrastructure:
${discovery.infrastructure.join(", ") || "Not detected"}

Git:
${discovery.git.isGitRepo ? `${discovery.git.branch ?? "detached"} (${discovery.git.latestCommit ?? "no commit summary"})` : "Not a git repository"}
`;
}

function buildArchitectureMap(discovery: DiscoveryResult): string {
  return `# ARCHITECTURE_MAP

## Top-level directories

${listOrNone(discovery.structure.topLevelDirectories)}

## Structure signals

- Source files: ${discovery.structure.sourceFileCount}
- Test files: ${discovery.structure.testFileCount}
- Nested subrepos: ${discovery.structure.subrepos.length}
- Git submodules: ${discovery.structure.submodules.length}

## Runtime hints

- Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}
- Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}
- CI providers: ${discovery.ci.providers.join(", ") || "Not detected"}
- Logging: ${discovery.logging.frameworks.join(", ") || "Not detected"}
- Metrics: ${discovery.metrics.tools.join(", ") || "Not detected"}
`;
}

function buildApiMap(
  discovery: DiscoveryResult,
  openApiSummaries: Array<{ path: string; title?: string; version?: string }>
): string {
  const openApiSection =
    openApiSummaries.length > 0
      ? openApiSummaries
          .map(
            (summary) =>
              `- ${summary.path}${summary.title ? ` | title: ${summary.title}` : ""}${summary.version ? ` | version: ${summary.version}` : ""}`
          )
          .join("\n")
      : "- No OpenAPI summaries available";

  return `# API_MAP

## API styles

${listOrNone(discovery.apis)}

## API-related files

${listOrNone(discovery.apiFiles)}

## OpenAPI summaries

${openApiSection}
`;
}

function buildDependencyGraph(discovery: DiscoveryResult): string {
  const sections =
    discovery.dependencies.length > 0
      ? discovery.dependencies
          .map(
            (manifest) => `## ${manifest.path}

- Ecosystem: ${manifest.ecosystem}
- Dependencies tracked: ${manifest.dependencies.length}
${listOrNone(manifest.dependencies.slice(0, 20))}`
          )
          .join("\n\n")
      : "No dependency manifests were parsed.";

  return `# DEPENDENCY_GRAPH

${sections}
`;
}

function buildStackProfile(discovery: DiscoveryResult): string {
  return `# STACK_PROFILE

## Languages

${listOrNone(discovery.languages)}

## Frameworks

${listOrNone(discovery.frameworks)}

## APIs

${listOrNone(discovery.apis)}

## Infrastructure

${listOrNone(discovery.infrastructure)}

## Testing

${listOrNone(discovery.testing)}

## Cross-cutting integrations

- CI/CD: ${discovery.ci.providers.join(", ") || "Not detected"}
- Structured logging: ${discovery.logging.structured ? "Yes" : "No"}
- Metrics: ${discovery.metrics.tools.join(", ") || "Not detected"}
- Alerts: ${discovery.metrics.alertsConfigured ? "Detected" : "Not detected"}
`;
}

function buildArchitectureSnapshot(discovery: DiscoveryResult): string {
  return `# ARCHITECTURE

## Current snapshot

- Repository: ${discovery.repoName}
- Project type: ${inferProjectType(discovery)}
- Languages: ${discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}
- API styles: ${discovery.apis.join(", ") || "Not detected"}
- Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}
- CI/CD: ${discovery.ci.providers.join(", ") || "Not detected"}
- Observability: logging=${discovery.logging.frameworks.join(", ") || "none"}, metrics=${discovery.metrics.tools.join(", ") || "none"}
`;
}

function buildStyleGuide(discovery: DiscoveryResult): string {
  const guidance: string[] = [];

  if (discovery.languages.includes("TypeScript")) {
    guidance.push("Prefer strict typing, small modules, and explicit boundary contracts.");
  }
  if (discovery.languages.includes("Python")) {
    guidance.push("Keep modules import-safe, typed where practical, and formatter-friendly.");
  }
  if (discovery.languages.includes("Go")) {
    guidance.push("Favor small interfaces, package ownership, and context-aware I/O.");
  }
  if (discovery.languages.includes("Java")) {
    guidance.push("Keep service boundaries explicit and configuration discoverable.");
  }

  if (guidance.length === 0) {
    guidance.push("Preserve a modular structure, readable naming, and explicit operational contracts.");
  }

  return `# STYLE_GUIDE

${listOrNone(guidance)}
`;
}

async function createIfMissing(filePath: string, content: string): Promise<void> {
  if (!(await fileExists(filePath))) {
    await writeFileEnsured(filePath, content);
  }
}

export async function initializeProjectMemory(
  outputPath: string,
  discovery: DiscoveryResult
): Promise<{
  memoryDir: string;
  reportsDir: string;
  docsDir: string;
  runtimeMemoryDir: string;
  learningDir: string;
  taskBoardDir: string;
  proposalDir: string;
  patchProposalDir: string;
}> {
  const memoryDir = path.join(outputPath, "AI_CONTEXT");
  const runtimeMemoryDir = path.join(outputPath, "memory");
  const learningDir = path.join(runtimeMemoryDir, "learnings");
  const reportsDir = path.join(outputPath, "reports");
  const docsDir = path.join(outputPath, "docs");
  const taskBoardDir = path.join(outputPath, "tasks");
  const proposalDir = path.join(docsDir, "proposals");
  const patchProposalDir = path.join(outputPath, "patch_proposals");

  await ensureDir(memoryDir);
  await ensureDir(runtimeMemoryDir);
  await ensureDir(learningDir);
  await ensureDir(reportsDir);
  await ensureDir(docsDir);
  await fs.rm(proposalDir, { recursive: true, force: true });
  await fs.rm(patchProposalDir, { recursive: true, force: true });
  await ensureDir(taskBoardDir);
  await ensureDir(proposalDir);
  await ensureDir(patchProposalDir);

  logger.info("Initialized filesystem memory directories", {
    component: "memory",
    action: "memory_write",
    repoName: discovery.repoName,
    outputPath,
    reportsDir,
    proposalDir,
    patchProposalDir
  });

  await createIfMissing(path.join(memoryDir, "AGENTS.md"), DEFAULT_AGENT_ROSTER);
  await createIfMissing(path.join(memoryDir, "RULES.md"), DEFAULT_RULES);
  await createIfMissing(path.join(memoryDir, "ERRORS.md"), "# ERRORS\n");
  await createIfMissing(path.join(memoryDir, "DECISIONS.md"), "# DECISIONS\n\n- Adopt non-destructive analysis as the operating mode.\n");
  await createIfMissing(path.join(memoryDir, "TASKS.md"), "# TASKS\n");
  await createIfMissing(path.join(memoryDir, "LEARNINGS.md"), "# LEARNINGS\n");
  await createIfMissing(path.join(memoryDir, "ANNOTATIONS.md"), "# ANNOTATIONS\n\n- None recorded.\n");
  await createIfMissing(path.join(memoryDir, "CONTEXT.md"), "# CONTEXT\n");
  await createIfMissing(path.join(memoryDir, "ARCHITECTURE.md"), buildArchitectureSnapshot(discovery));
  await createIfMissing(path.join(memoryDir, "STYLE_GUIDE.md"), buildStyleGuide(discovery));

  return {
    memoryDir,
    reportsDir,
    docsDir,
    runtimeMemoryDir,
    learningDir,
    taskBoardDir,
    proposalDir,
    patchProposalDir
  };
}

export async function writeDiscoveryArtifacts(
  memoryDir: string,
  discovery: DiscoveryResult,
  openApiSummaries: Array<{ path: string; title?: string; version?: string }>
): Promise<void> {
  await writeFileEnsured(path.join(memoryDir, "PROJECT_MODEL.md"), buildProjectModel(discovery));
  await writeFileEnsured(path.join(memoryDir, "ARCHITECTURE_MAP.md"), buildArchitectureMap(discovery));
  await writeFileEnsured(path.join(memoryDir, "API_MAP.md"), buildApiMap(discovery, openApiSummaries));
  await writeFileEnsured(path.join(memoryDir, "DEPENDENCY_GRAPH.md"), buildDependencyGraph(discovery));
  await writeFileEnsured(path.join(memoryDir, "STACK_PROFILE.md"), buildStackProfile(discovery));
  logger.info("Wrote discovery artifacts", {
    component: "memory",
    action: "memory_write",
    repoName: discovery.repoName,
    memoryDir
  });
}

export async function updatePersistentMemory(
  context: ProjectContext,
  agentReports: AgentReport[]
): Promise<void> {
  const architecturePath = path.join(context.memoryDir, "ARCHITECTURE.md");
  const contextPath = path.join(context.memoryDir, "CONTEXT.md");
  const tasksPath = path.join(context.memoryDir, "TASKS.md");

  await writeFileEnsured(architecturePath, buildArchitectureSnapshot(context.discovery));

  const contextEntry = `
## ${context.scannedAt}

- Repo: ${context.repoName}
- Languages: ${context.discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${context.discovery.frameworks.join(", ") || "Unknown"}
- APIs: ${context.discovery.apis.join(", ") || "Not detected"}
- Highest risk: ${
    agentReports.find((report) => report.riskLevel === "high")
      ? "high"
      : agentReports.find((report) => report.riskLevel === "medium")
        ? "medium"
        : "low"
  }
`;
  await appendFileEnsured(contextPath, `${contextEntry}\n`);

  const generatedTasks = uniqueSorted(
    agentReports.flatMap((report) => report.recommendations).filter(Boolean)
  );

  if (generatedTasks.length > 0) {
    await appendFileEnsured(
      tasksPath,
      `\n## Generated backlog ${context.scannedAt}\n\n${generatedTasks.map((task) => `- ${task}`).join("\n")}\n`
    );
  }

  logger.info("Updated persistent AI context", {
    component: "memory",
    action: "memory_write",
    repoName: context.repoName,
    generatedTasks: generatedTasks.length
  });
}

export async function readExistingTasks(memoryDir: string): Promise<string> {
  return readTextSafe(path.join(memoryDir, "TASKS.md"));
}
