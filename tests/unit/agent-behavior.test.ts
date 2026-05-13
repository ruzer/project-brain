import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ObservabilityAgent } from "../../agents/observability_agent";
import { OptimizationAgent } from "../../agents/optimization_agent";
import { QAAgent } from "../../agents/qa_agent";
import { SecurityAgent } from "../../agents/security_agent";
import type { DependencyManifest, DiscoveryResult, ProjectContext } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

function makeDiscovery(overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  const files = overrides.files ?? ["package.json", "src/index.ts"];
  return {
    repoName: "agent-behavior",
    targetPath: "/tmp/agent-behavior",
    scannedAt: "2026-01-01T00:00:00.000Z",
    files,
    structure: {
      topLevelDirectories: ["src"],
      sampleFiles: files.slice(0, 8),
      subrepos: [],
      submodules: [],
      fileCount: files.length,
      sourceFileCount: 1,
      testFileCount: 0,
      ...overrides.structure
    },
    languages: ["TypeScript"],
    frameworks: [],
    apis: [],
    infrastructure: [],
    testing: [],
    dependencies: [],
    manifests: ["package.json"],
    apiFiles: [],
    infraFiles: [],
    dockerStageCount: 0,
    git: { isGitRepo: false, hasSubmodules: false },
    ci: { providers: [], configFiles: [] },
    logging: { frameworks: [], configFiles: [], structured: false },
    metrics: { tools: [], configFiles: [], alertsConfigured: false },
    recommendations: [],
    ...overrides
  };
}

function makeContext(outputDir: string, discoveryOverrides: Partial<DiscoveryResult> = {}): ProjectContext {
  const discovery = makeDiscovery(discoveryOverrides);
  return {
    repoName: discovery.repoName,
    targetPath: discovery.targetPath,
    outputPath: outputDir,
    scannedAt: discovery.scannedAt,
    discovery,
    memoryDir: path.join(outputDir, "AI_CONTEXT"),
    reportsDir: path.join(outputDir, "reports"),
    docsDir: path.join(outputDir, "docs"),
    runtimeMemoryDir: path.join(outputDir, "memory"),
    learningDir: path.join(outputDir, "memory", "learnings"),
    taskBoardDir: path.join(outputDir, "tasks"),
    proposalDir: path.join(outputDir, "proposal"),
    patchProposalDir: path.join(outputDir, "patch_proposals")
  };
}

function stubAI<T extends QAAgent | OptimizationAgent>(agent: T): T {
  const writable = agent as T & {
    aiRouter: {
      ask: () => Promise<string>;
    };
  };
  writable.aiRouter = {
    async ask() {
      return JSON.stringify({ issues: [], proposed_improvements: [] });
    }
  };
  return agent;
}

describe("agent behavior", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("QAAgent reports high risk when a source-heavy repository has no tests", async () => {
    const outputDir = await createTempOutputDir("project-brain-qa-agent");
    cleanupTargets.push(outputDir);
    const context = makeContext(outputDir, {
      structure: {
        topLevelDirectories: ["src"],
        sampleFiles: [],
        subrepos: [],
        submodules: [],
        fileCount: 30,
        sourceFileCount: 30,
        testFileCount: 0
      }
    });

    const report = await stubAI(new QAAgent()).run(context);

    expect(report.riskLevel).toBe("high");
    expect(report.findings).toContain("No automated test framework was detected.");
    expect(report.findings).toContain("The repository has source-heavy areas without any test files.");
    expect(report.coverage?.some((entry) => entry.area === "abuse_protection" && entry.status === "not-reviewed")).toBe(true);
  });

  it("SecurityAgent reports versioned sensitive files and missing lockfiles", async () => {
    const outputDir = await createTempOutputDir("project-brain-security-agent");
    cleanupTargets.push(outputDir);
    const dependencies: DependencyManifest[] = [
      {
        path: "package.json",
        ecosystem: "npm",
        dependencies: ["express"]
      }
    ];
    const context = makeContext(outputDir, {
      files: ["package.json", ".env", "Dockerfile"],
      dependencies,
      infrastructure: ["Dockerfile"],
      dockerStageCount: 1
    });

    const report = await new SecurityAgent().run(context);

    expect(report.riskLevel).toBe("high");
    expect(report.securityFindings?.some((finding) => finding.title.includes("Secretos"))).toBe(true);
    expect(report.securityFindings?.some((finding) => finding.title.includes("Dependencias sin lockfile"))).toBe(true);
    expect(report.securityFindings?.some((finding) => finding.title.includes("Dockerfile"))).toBe(true);
  });

  it("ObservabilityAgent reports missing logging, metrics, and alerting", async () => {
    const outputDir = await createTempOutputDir("project-brain-observability-agent");
    cleanupTargets.push(outputDir);
    const context = makeContext(outputDir);

    const report = await new ObservabilityAgent().run(context);
    const content = await readFile(report.outputPath, "utf8");

    expect(report.findings).toContain("No dedicated logging framework was detected.");
    expect(report.findings).toContain("No metrics or tracing integration was detected.");
    expect(report.findings).toContain("No alerting configuration was detected.");
    expect(report.coverage?.some((entry) => entry.area === "observability" && entry.status === "finding")).toBe(true);
    expect(content).toContain("Observability Report");
  });

  it("OptimizationAgent reports dependency, Docker, and CI optimization signals", async () => {
    const outputDir = await createTempOutputDir("project-brain-optimization-agent");
    cleanupTargets.push(outputDir);
    const dependencies: DependencyManifest[] = [
      {
        path: "package.json",
        ecosystem: "npm",
        dependencies: Array.from({ length: 81 }, (_, index) => `dep-${index}`)
      }
    ];
    const context = makeContext(outputDir, {
      dependencies,
      infrastructure: ["Dockerfile"],
      dockerStageCount: 1,
      ci: { providers: [], configFiles: [] },
      structure: {
        topLevelDirectories: ["src"],
        sampleFiles: [],
        subrepos: [],
        submodules: [],
        fileCount: 300,
        sourceFileCount: 300,
        testFileCount: 10
      }
    });

    const report = await stubAI(new OptimizationAgent()).run(context);

    expect(report.riskLevel).toBe("medium");
    expect(report.findings.some((finding) => finding.includes("High dependency surface"))).toBe(true);
    expect(report.findings).toContain("Docker builds appear single-stage, which often increases image size and attack surface.");
    expect(report.findings).toContain("Large codebase detected without CI acceleration or caching signals.");
  });
});
