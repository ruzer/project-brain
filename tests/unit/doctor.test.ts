import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { runDoctor } from "../../core/doctor";
import type { ModelInventory } from "../../core/ai_router/router";
import { createTempOutputDir, fixtureRepoPath } from "../helpers";

function createInventory(): ModelInventory {
  return {
    config: {
      localModel: "qwen2.5-coder:7b",
      cloudModel: "gpt-4.1",
      fallbackModel: "deepseek-coder:6.7b",
      reasoningModel: "llama3.1:8b",
      offlineMode: true,
      allowRemoteOllama: true,
      ollamaTimeoutMs: 180000,
      profiles: {
        worker: "qwen2.5-coder:7b",
        reviewer: "deepseek-coder:6.7b",
        reasoning: "llama3.1:8b",
        planner: "kimi-k2.5:cloud",
        synthesizer: "llama3.1:8b"
      },
      routing: {},
      taskProfiles: {}
    },
    localProvider: "ollama",
    localModelsAvailable: ["deepseek-coder:6.7b", "llama3.1:8b", "qwen2.5-coder:7b"],
    availableModels: [
      { name: "deepseek-coder:6.7b", residency: "local", offlineCapable: true },
      { name: "llama3.1:8b", residency: "local", offlineCapable: true },
      { name: "qwen2.5-coder:7b", residency: "local", offlineCapable: true },
      { name: "kimi-k2.5:cloud", residency: "remote", offlineCapable: false }
    ],
    localConfigured: "qwen2.5-coder:7b",
    fallbackConfigured: "deepseek-coder:6.7b",
    resolvedProfiles: {
      worker: "qwen2.5-coder:7b",
      reviewer: "deepseek-coder:6.7b",
      reasoning: "llama3.1:8b",
      planner: "kimi-k2.5:cloud",
      synthesizer: "llama3.1:8b"
    },
    cloudConfigured: {
      provider: "openai",
      model: "gpt-4.1"
    },
    routing: {},
    taskProfiles: {},
    offlineMode: true,
    remoteOllamaAllowed: true,
    offlineReady: true
  };
}

describe("doctor", () => {
  it("writes a doctor report and classifies the environment", async () => {
    const outputDir = await createTempOutputDir("project-brain-doctor");
    const projectRoot = await createTempOutputDir("project-brain-doctor-root");
    await mkdir(path.join(projectRoot, "config"), { recursive: true });
    await mkdir(path.join(projectRoot, "dist", "cli"), { recursive: true });
    await writeFile(path.join(projectRoot, "package.json"), '{"name":"project-brain","version":"0.1.0"}\n', "utf8");
    await writeFile(path.join(projectRoot, "config", "models.json"), '{"localModel":"qwen2.5-coder:7b"}\n', "utf8");
    await writeFile(path.join(projectRoot, "dist", "cli", "project-brain.js"), "console.log('ok');\n", "utf8");

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async ask() {
          return "";
        },
        async selectModel() {
          return {
            preferredRoute: "local",
            selectedRoute: "local",
            provider: "ollama",
            model: "qwen2.5-coder:7b",
            profile: "worker",
            residency: "local",
            reason: "test",
            offlineCapable: true
          };
        },
        async listModels() {
          return createInventory();
        }
      }
    });

    const context = await orchestrator.initTarget(fixtureRepoPath, outputDir);
    const result = await runDoctor(
      context,
      {
        async listModels() {
          return createInventory();
        }
      },
      {
        projectRoot,
        async runCommand(command, args) {
          const joined = `${command} ${args.join(" ")}`;
          if (joined === "git --version") {
            return { ok: true, exitCode: 0, stdout: "git version 2.42.0", stderr: "" };
          }
          if (joined.includes("rev-parse --is-inside-work-tree")) {
            return { ok: true, exitCode: 0, stdout: "true", stderr: "" };
          }
          if (joined.includes("branch --show-current")) {
            return { ok: true, exitCode: 0, stdout: "main", stderr: "" };
          }
          if (joined === "ollama --version") {
            return { ok: true, exitCode: 0, stdout: "ollama version 0.17.7", stderr: "" };
          }
          return { ok: false, exitCode: 1, stdout: "", stderr: "unexpected command" };
        }
      }
    );

    expect(result.summary.failed).toBe(0);
    expect(result.summary.warnings).toBe(0);
    expect(result.checks.some((check) => check.id === "swarm-local-readiness" && check.status === "pass")).toBe(true);
    expect(result.checks.some((check) => check.id === "model-profiles" && check.status === "pass")).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.label === "Inspect Operational Status")).toBe(true);
    expect(result.reportPath).toContain("doctor.md");
    expect(result.memoryPath).toContain("doctor.json");
  });
});
