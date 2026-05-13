import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectContext } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

const mocked = vi.hoisted(() => ({
  invoke: vi.fn()
}));

vi.mock("@langchain/ollama", () => ({
  ChatOllama: vi.fn().mockImplementation(function ChatOllama() {
    return {};
  })
}));

vi.mock("deepagents", () => ({
  FilesystemBackend: vi.fn().mockImplementation(function FilesystemBackend() {
    return {};
  }),
  createDeepAgent: vi.fn().mockImplementation(function createDeepAgent() {
    return {
    invoke: mocked.invoke
    };
  })
}));

function makeContext(outputDir: string): ProjectContext {
  return {
    repoName: "deepagents-repo",
    targetPath: outputDir,
    outputPath: outputDir,
    scannedAt: "2026-01-01T00:00:00.000Z",
    discovery: {
      repoName: "deepagents-repo",
      targetPath: outputDir,
      scannedAt: "2026-01-01T00:00:00.000Z",
      files: ["package.json", "src/index.ts"],
      structure: {
        topLevelDirectories: ["src", "tests"],
        sampleFiles: ["package.json", "src/index.ts"],
        subrepos: [],
        submodules: [],
        fileCount: 2,
        sourceFileCount: 1,
        testFileCount: 0
      },
      languages: ["TypeScript"],
      frameworks: [],
      apis: [],
      infrastructure: [],
      testing: ["Vitest"],
      dependencies: [],
      manifests: ["package.json"],
      apiFiles: [],
      infraFiles: [],
      dockerStageCount: 0,
      git: { isGitRepo: false, hasSubmodules: false },
      ci: { providers: [], configFiles: [] },
      logging: { frameworks: [], configFiles: [], structured: false },
      metrics: { tools: [], configFiles: [], alertsConfigured: false },
      recommendations: []
    },
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

function assistant() {
  return {
    async listModels() {
      return {
        availableModels: [{ name: "qwen2.5-coder:7b", residency: "local", offlineCapable: true }],
        resolvedProfiles: {
          worker: "qwen2.5-coder:7b",
          reviewer: "qwen2.5-coder:7b",
          reasoning: "qwen2.5-coder:7b",
          planner: "qwen2.5-coder:7b",
          synthesizer: "qwen2.5-coder:7b"
        },
        localConfigured: "qwen2.5-coder:7b",
        fallbackConfigured: "qwen2.5-coder:7b"
      };
    }
  };
}

describe("deepagents swarm", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    mocked.invoke.mockReset();
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("exports the main deepagents engine function", async () => {
    const module = await import("../../core/deepagents_swarm");
    expect(typeof module.runDeepAgentsSwarm).toBe("function");
  });

  it("rejects invalid input with a handled error", async () => {
    const outputDir = await createTempOutputDir("project-brain-deepagents-invalid");
    cleanupTargets.push(outputDir);
    const { runDeepAgentsSwarm } = await import("../../core/deepagents_swarm");

    await expect(runDeepAgentsSwarm(makeContext(outputDir), "   ", assistant())).rejects.toThrow("non-empty intent");
  });

  it("returns the same SwarmRunResult shape as the bounded engine", async () => {
    const outputDir = await createTempOutputDir("project-brain-deepagents-shape");
    cleanupTargets.push(outputDir);
    mocked.invoke.mockResolvedValue({
      structuredResponse: {
        headline: "Deepagents completed.",
        summary: "Structured response.",
        findings: ["Finding"],
        priorities: ["Priority"],
        next_steps: ["Next"],
        task_summaries: []
      }
    });
    const { runDeepAgentsSwarm } = await import("../../core/deepagents_swarm");

    const result = await runDeepAgentsSwarm(makeContext(outputDir), "inspect src", assistant(), { preset: "balanced" });

    expect(result).toMatchObject({
      engine: "deepagents",
      intent: "inspect src",
      planner: { model: "qwen2.5-coder:7b" },
      synthesis: { headline: "Deepagents completed." }
    });
    expect(result.reportPath).toBeTruthy();
    expect(result.memoryPath).toBeTruthy();
    expect(Array.isArray(result.tasks)).toBe(true);
    expect(Array.isArray(result.workerResults)).toBe(true);
  });

  it("uses less parallelism for cheap than thorough", async () => {
    const cheapOutput = await createTempOutputDir("project-brain-deepagents-cheap");
    const thoroughOutput = await createTempOutputDir("project-brain-deepagents-thorough");
    cleanupTargets.push(cheapOutput, thoroughOutput);
    mocked.invoke.mockResolvedValue({
      structuredResponse: {
        headline: "Deepagents completed.",
        summary: "Structured response.",
        findings: [],
        priorities: [],
        next_steps: [],
        task_summaries: []
      }
    });
    const { runDeepAgentsSwarm } = await import("../../core/deepagents_swarm");

    const cheap = await runDeepAgentsSwarm(makeContext(cheapOutput), "inspect src", assistant(), { preset: "cheap" });
    const thorough = await runDeepAgentsSwarm(makeContext(thoroughOutput), "inspect src", assistant(), { preset: "thorough" });

    expect(cheap.parallelism.selected).toBeLessThan(thorough.parallelism.selected);
  });
});
