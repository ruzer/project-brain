import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Swarm runtime", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("delegates bounded tasks across planner, workers, and synthesizer", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          if (profile === "planner") {
            return {
              preferredRoute: "cloud",
              selectedRoute: "cloud",
              provider: "ollama",
              model: "kimi-k2.5:cloud",
              profile,
              residency: "remote",
              reason: "planner",
              offlineCapable: false
            };
          }

          if (profile === "synthesizer") {
            return {
              preferredRoute: "local",
              selectedRoute: "local",
              provider: "ollama",
              model: "llama3.1:8b",
              profile,
              residency: "local",
              reason: "synthesizer",
              offlineCapable: true
            };
          }

          return {
            preferredRoute: "local",
            selectedRoute: "local",
            provider: "ollama",
            model: profile === "reviewer" ? "deepseek-coder:6.7b" : profile === "reasoning" ? "llama3.1:8b" : "qwen2.5-coder:7b",
            profile,
            residency: "local",
            reason: "worker",
            offlineCapable: true
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Split the request into scan, risk review, and next-step reasoning.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan the repository",
                  goal: "Identify stack and core areas relevant to the request.",
                  profile: "worker",
                  deliverable: "Repository scan summary"
                },
                {
                  taskId: "risk",
                  title: "Review critical risks",
                  goal: "Surface concrete risks and weak spots.",
                  profile: "reviewer",
                  deliverable: "Risk findings"
                },
                {
                  taskId: "next",
                  title: "Reason about next steps",
                  goal: "Turn findings into practical next actions.",
                  profile: "reasoning",
                  deliverable: "Decision guidance"
                }
              ]
            });
          }

          if (input.profile === "worker") {
            return JSON.stringify({
              summary: "The repository is TypeScript-first and already has strong analysis primitives.",
              findings: ["The control plane is present but swarm execution was missing."],
              recommendations: ["Add a bounded multi-model swarm entry point."]
            });
          }

          if (input.profile === "reviewer") {
            return JSON.stringify({
              summary: "The main risk is weak delegation between the available models.",
              findings: ["Strategic planning and worker execution were still mostly single-hop."],
              recommendations: ["Separate planner, reviewer, and synthesizer roles."]
            });
          }

          if (input.profile === "reasoning") {
            return JSON.stringify({
              summary: "The best next step is a bounded swarm instead of full autonomy.",
              findings: ["The architecture already has routing, firewall, and task packets to build on."],
              recommendations: ["Keep the swarm analysis-only in v1."]
            });
          }

          return JSON.stringify({
            headline: "The swarm completed a bounded delegated review.",
            summary: "Planner and worker outputs were merged into a single decision-oriented result.",
            priorities: ["Use Kimi for planning", "Keep local workers cheap", "Persist swarm artifacts"],
            next_steps: ["Connect swarm output to ask", "Add firewall-aware execution gates later"]
          });
        }
      }
    });

    const result = await orchestrator.swarm(fixtureRepoPath, outputDir, "ayudame a mejorar este repo", {
      parallelism: 2,
      chunkSize: 1,
      maxQueuedTasks: 7
    });

    expect(result.tasks).toHaveLength(3);
    expect(result.planner.model).toBe("kimi-k2.5:cloud");
    expect(result.workerResults.some((entry) => entry.profile === "reviewer")).toBe(true);
    expect(result.synthesis.model).toBe("llama3.1:8b");
    expect(result.chunking.selectedChunkSize).toBe(1);
    expect(result.chunking.scopeBias).toBe("balanced");
    expect(result.chunking.scopeChunks).toBeGreaterThan(0);
    expect(result.chunking.queuedTasks).toBeGreaterThan(result.tasks.length);
    expect(result.resilience.queueBudget).toBe(7);
    expect(result.resilience.adaptiveQueueBudget).toBe(false);
    expect(result.resilience.droppedTasks).toBeGreaterThan(0);
    expect(result.resilience.taskTimeoutMs).toBe(20_000);
    expect(result.resilience.failedTasks).toBe(0);
    expect(result.parallelism.selected).toBe(2);
    expect(result.parallelism.requested).toBe(2);
    expect(["low", "medium", "high"]).toContain(result.parallelism.pressure);

    await access(result.reportPath);
    await access(result.memoryPath);

    const report = await readFile(result.reportPath, "utf8");
    const memory = await readFile(result.memoryPath, "utf8");

    expect(report).toContain("Swarm Run");
    expect(report).toContain("kimi-k2.5:cloud");
    expect(report).toContain("Queue budget: 7");
    expect(report).toContain("Worker timeout: 20000 ms");
    expect(report).toContain("Chunk size: 1");
    expect(report).toContain("Scope bias: balanced");
    expect(report).toContain("Parallel workers: 2");
    expect(report).toContain("Scope:");
    expect(report).toContain("Review critical risks");
    expect(memory).toContain("\"workers\"");
  });

  it("salvages worker and synthesis outputs when local models return markdown instead of JSON", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-markdown");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: profile === "planner" ? "cloud" : "local",
            selectedRoute: profile === "planner" ? "cloud" : "local",
            provider: "ollama",
            model: profile === "planner" ? "kimi-k2.5:cloud" : "qwen2.5-coder:7b",
            profile,
            residency: profile === "planner" ? "remote" : "local",
            reason: "test",
            offlineCapable: profile !== "planner"
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Run a single bounded worker then synthesize it.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan repository",
                  goal: "Inspect the main repository signals.",
                  profile: "worker",
                  deliverable: "Short scan"
                }
              ]
            });
          }

          if (input.profile === "worker") {
            return [
              "Summary: The repo already has strong control-plane primitives, but local workers sometimes answer in markdown.",
              "Findings:",
              "- Worker outputs can be useful even when they do not serialize as JSON.",
              "- The swarm should salvage markdown sections before giving up.",
              "Recommendations:",
              "- Recover summary/findings/recommendations from labeled markdown sections.",
              "- Keep the JSON prompt, but tolerate plain-text fallbacks."
            ].join("\n");
          }

          return [
            "Headline: Salvaged markdown worker outputs",
            "Summary: The swarm preserved useful signal from a non-JSON local-model response.",
            "Priorities:",
            "- Repair markdown and labeled text before degrading to empty findings.",
            "Next steps:",
            "- Add parser coverage for markdown-shaped local outputs."
          ].join("\n");
        }
      }
    });

    const result = await orchestrator.swarm(fixtureRepoPath, outputDir, "mejora el parser del swarm", {
      parallelism: 1,
      chunkSize: 1,
      maxQueuedTasks: 1
    });

    expect(result.workerResults[0]?.summary).toContain("strong control-plane primitives");
    expect(result.workerResults[0]?.findings).toContain("Worker outputs can be useful even when they do not serialize as JSON.");
    expect(result.workerResults[0]?.recommendations).toContain("Recover summary/findings/recommendations from labeled markdown sections.");
    expect(result.synthesis.headline).toBe("Salvaged markdown worker outputs");
    expect(result.synthesis.nextSteps).toContain("Add parser coverage for markdown-shaped local outputs.");

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Salvaged markdown worker outputs");
    expect(report).toContain("Worker outputs can be useful even when they do not serialize as JSON.");
  });

  it("splits timed-out chunks into smaller queued tasks before failing", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-timeout");
    cleanupTargets.push(outputDir);
    const timedOutScopes = new Set<string>();

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: profile === "planner" ? "cloud" : "local",
            selectedRoute: profile === "planner" ? "cloud" : "local",
            provider: "ollama",
            model: profile === "planner" ? "kimi-k2.5:cloud" : "qwen2.5-coder:7b",
            profile,
            residency: profile === "planner" ? "remote" : "local",
            reason: "test",
            offlineCapable: profile !== "planner"
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Split the repo into smaller queued chunks.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan the repository",
                  goal: "Inspect the relevant repository areas.",
                  profile: "worker",
                  deliverable: "Chunked scan"
                }
              ]
            });
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "The swarm recovered from timeouts by splitting chunks.",
              summary: "Timed-out chunks were split and retried as smaller work units.",
              priorities: ["Keep local prompts small"],
              next_steps: ["Tune defaults from real runs"]
            });
          }

          const prompt = input.prompt;
          const scopeLine = prompt.split("\n").find((line) => line.startsWith("Scope paths: ")) ?? "";
          const scope = scopeLine.replace("Scope paths: ", "");

          if (scope.includes(",") && !timedOutScopes.has(scope)) {
            timedOutScopes.add(scope);
            throw new Error("AbortError: timeout");
          }

          return JSON.stringify({
            summary: `Processed scope ${scope}.`,
            findings: [`Checked ${scope}`],
            recommendations: [`Keep ${scope} bounded`]
          });
        }
      }
    });

    const result = await orchestrator.swarm(fixtureRepoPath, outputDir, "divide este repo en trozos pequeños", {
      parallelism: 2,
      chunkSize: 2,
      taskTimeoutMs: 1000,
      maxRetries: 1
    });

    expect(result.resilience.timedOutTasks).toBeGreaterThan(0);
    expect(result.resilience.splitTasks).toBeGreaterThan(0);
    expect(result.resilience.failedTasks).toBe(0);
    expect(result.workerResults.every((entry) => entry.scopePaths.length === 1)).toBe(true);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Timed out tasks:");
    expect(report).toContain("Split tasks:");
  });

  it("samples multiple parent tasks first when the queue budget is tight", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-round-robin");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: profile === "planner" ? "cloud" : "local",
            selectedRoute: profile === "planner" ? "cloud" : "local",
            provider: "ollama",
            model: profile === "planner" ? "kimi-k2.5:cloud" : "qwen2.5-coder:7b",
            profile,
            residency: profile === "planner" ? "remote" : "local",
            reason: "test",
            offlineCapable: profile !== "planner"
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Cover multiple workstreams before deepening any single one.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan the repository",
                  goal: "Inspect the repo shape.",
                  profile: "worker",
                  deliverable: "Scan summary"
                },
                {
                  taskId: "risk",
                  title: "Review critical risks",
                  goal: "Inspect risk hotspots.",
                  profile: "reviewer",
                  deliverable: "Risk review"
                },
                {
                  taskId: "next",
                  title: "Reason about next steps",
                  goal: "Turn findings into actions.",
                  profile: "reasoning",
                  deliverable: "Next-step guidance"
                }
              ]
            });
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "Round-robin queue completed.",
              summary: "The swarm sampled multiple parent tasks before spending more budget on deeper chunks.",
              priorities: ["Keep queue ordering balanced"],
              next_steps: ["Tune queue ordering with real self-runs"]
            });
          }

          const titleLine = input.prompt.split("\n").find((line) => line.startsWith("Task title: ")) ?? "";
          return JSON.stringify({
            summary: titleLine.replace("Task title: ", ""),
            findings: [],
            recommendations: []
          });
        }
      }
    });

    const result = await orchestrator.swarm(fixtureRepoPath, outputDir, "muestrame cobertura balanceada", {
      parallelism: 1,
      chunkSize: 1,
      maxQueuedTasks: 4
    });

    expect(result.chunking.queueStrategy).toBe("round-robin");
    expect(result.workerResults.slice(0, 3).map((entry) => entry.parentTaskId)).toEqual(["scan", "risk", "next"]);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Queue strategy: round-robin");
  });

  it("forces planner and synthesis onto local models when the run budget is short", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-local-budget");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          const remoteAllowed = input.allowRemote !== false;
          const remoteModel = profile === "planner" ? "kimi-k2.5:cloud" : "llama3.1:8b";
          const localModel = profile === "planner" ? "llama3.1:8b" : "llama3.1:8b";
          const residency = remoteAllowed && profile === "planner" ? "remote" : "local";

          return {
            preferredRoute: remoteAllowed && profile === "planner" ? "cloud" : "local",
            selectedRoute: residency === "remote" ? "cloud" : "local",
            provider: "ollama",
            model: residency === "remote" ? remoteModel : localModel,
            profile,
            residency,
            reason: "test",
            offlineCapable: residency === "local"
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Stay local under short budgets.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan the repository",
                  goal: "Inspect the repo.",
                  profile: "worker",
                  deliverable: "Scan summary"
                }
              ]
            });
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "Short-budget local swarm completed.",
              summary: "Planner and synthesis stayed local because the run budget was short.",
              priorities: ["Prefer local planning under short budgets"],
              next_steps: ["Let users widen budgets when they want Kimi"]
            });
          }

          return JSON.stringify({
            summary: "Local worker finished.",
            findings: [],
            recommendations: []
          });
        }
      }
    });

    const result = await orchestrator.swarm(fixtureRepoPath, outputDir, "corre un swarm corto", {
      runTimeoutMs: 30_000,
      plannerTimeoutMs: 8_000,
      synthesisTimeoutMs: 8_000
    });

    expect(result.resilience.localBudgetMode).toBe(true);
    expect(result.resilience.adaptiveQueueBudget).toBe(true);
    expect(result.parallelism.selected).toBeLessThanOrEqual(2);
    expect(result.resilience.queueBudget).toBeLessThanOrEqual(6);
    expect(result.planner.model).toBe("llama3.1:8b");
    expect(result.planner.residency).toBe("local");
    expect(result.synthesis.model).toBe("llama3.1:8b");

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Local budget mode: yes");
  });

  it("prioritizes product code areas ahead of tests and dotfiles under source-first bias", async () => {
    const repoDir = await createTempOutputDir("project-brain-swarm-priority-repo");
    const outputDir = path.join(os.tmpdir(), `project-brain-swarm-priority-output-${Date.now()}`);
    cleanupTargets.push(repoDir, outputDir);

    await mkdir(path.join(repoDir, "core"), { recursive: true });
    await mkdir(path.join(repoDir, "src"), { recursive: true });
    await mkdir(path.join(repoDir, "tests"), { recursive: true });
    await mkdir(path.join(repoDir, ".github", "workflows"), { recursive: true });
    await writeFile(path.join(repoDir, "core", "service.ts"), "export const service = true;\n", "utf8");
    await writeFile(path.join(repoDir, "src", "index.ts"), "export const main = true;\n", "utf8");
    await writeFile(path.join(repoDir, "tests", "service.test.ts"), "export const testValue = true;\n", "utf8");
    await writeFile(path.join(repoDir, "tests", "other.test.ts"), "export const otherTest = true;\n", "utf8");
    await writeFile(path.join(repoDir, "tests", "api.test.ts"), "export const apiTest = true;\n", "utf8");
    await writeFile(path.join(repoDir, ".github", "workflows", "ci.yml"), "name: ci\n", "utf8");
    await writeFile(path.join(repoDir, ".gitignore"), "node_modules\n", "utf8");
    await writeFile(path.join(repoDir, ".eslintrc.js"), "module.exports = {};\n", "utf8");
    await writeFile(path.join(repoDir, "package.json"), '{"name":"scope-priority","version":"1.0.0"}\n', "utf8");

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: profile === "planner" ? "cloud" : "local",
            selectedRoute: "local",
            provider: "ollama",
            model: "llama3.1:8b",
            profile,
            residency: "local",
            reason: "test",
            offlineCapable: true
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Focus on the most code-heavy top-level areas first.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan the repository",
                  goal: "Inspect prioritized top-level areas.",
                  profile: "worker",
                  deliverable: "Scan summary"
                }
              ]
            });
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "Priority ordering completed.",
              summary: "Source-heavy areas were scanned before dotfiles.",
              priorities: ["Keep source-first ordering"],
              next_steps: ["Tune scoring if needed"]
            });
          }

          const scopeLine = input.prompt.split("\n").find((line) => line.startsWith("Scope paths: ")) ?? "";
          const scope = scopeLine.replace("Scope paths: ", "");
          return JSON.stringify({
            summary: `Processed ${scope}.`,
            findings: [],
            recommendations: []
          });
        }
      }
    });

    const result = await orchestrator.swarm(repoDir, outputDir, "prioriza codigo real", {
      parallelism: 1,
      chunkSize: 1,
      maxQueuedTasks: 2,
      runTimeoutMs: 30_000,
      plannerTimeoutMs: 8_000,
      synthesisTimeoutMs: 8_000,
      scopeBias: "source-first"
    });

    expect(result.chunking.scopeBias).toBe("source-first");
    expect(result.workerResults[0]?.scopePaths[0]).toBe("core");
    expect(result.workerResults[1]?.scopePaths[0]).toBe("src");

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Scope bias: source-first");
  });

  it("uses intent scope hints to prioritize the referenced project area first", async () => {
    const repoDir = await createTempOutputDir("project-brain-swarm-scope-hints-repo");
    const outputDir = path.join(os.tmpdir(), `project-brain-swarm-scope-hints-output-${Date.now()}`);
    cleanupTargets.push(repoDir, outputDir);

    await mkdir(path.join(repoDir, "core", "swarm_runtime"), { recursive: true });
    await mkdir(path.join(repoDir, "tests", "integration"), { recursive: true });
    await writeFile(path.join(repoDir, "core", "swarm_runtime", "index.ts"), "export const runtime = true;\n", "utf8");
    await writeFile(path.join(repoDir, "tests", "integration", "a.test.ts"), "export const a = true;\n", "utf8");
    await writeFile(path.join(repoDir, "tests", "integration", "b.test.ts"), "export const b = true;\n", "utf8");
    await writeFile(path.join(repoDir, "tests", "integration", "c.test.ts"), "export const c = true;\n", "utf8");
    await writeFile(path.join(repoDir, "package.json"), '{"name":"scope-hints","version":"1.0.0"}\n', "utf8");

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: profile === "planner" ? "cloud" : "local",
            selectedRoute: "local",
            provider: "ollama",
            model: "llama3.1:8b",
            profile,
            residency: "local",
            reason: "test",
            offlineCapable: true
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Prefer the scope named directly in the user intent.",
              tasks: [
                {
                  taskId: "scan",
                  title: "Scan the repository",
                  goal: "Inspect the referenced scope.",
                  profile: "worker",
                  deliverable: "Scan summary"
                }
              ]
            });
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "Scope hints were honored.",
              summary: "The swarm prioritized the area referenced in the user intent.",
              priorities: ["Honor explicit scope mentions first"],
              next_steps: ["Extend scope hints to deeper retries"]
            });
          }

          const scopeLine = input.prompt.split("\n").find((line) => line.startsWith("Scope paths: ")) ?? "";
          const scope = scopeLine.replace("Scope paths: ", "");
          return JSON.stringify({
            summary: `Processed ${scope}.`,
            findings: [],
            recommendations: []
          });
        }
      }
    });

    const result = await orchestrator.swarm(repoDir, outputDir, "revisa core/swarm_runtime y prioriza mejoras reales", {
      parallelism: 1,
      chunkSize: 1,
      maxQueuedTasks: 1,
      runTimeoutMs: 30_000,
      plannerTimeoutMs: 8_000,
      synthesisTimeoutMs: 8_000
    });

    expect(result.chunking.scopeHints).toContain("core/swarm_runtime");
    expect(result.workerResults[0]?.scopePaths[0]).toBe("core");

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Scope hints: core/swarm_runtime");
  });

  it("splits a timed-out single directory scope into immediate child scopes before retrying", async () => {
    const repoDir = await createTempOutputDir("project-brain-swarm-subdir-split-repo");
    const outputDir = path.join(os.tmpdir(), `project-brain-swarm-subdir-split-output-${Date.now()}`);
    cleanupTargets.push(repoDir, outputDir);

    await mkdir(path.join(repoDir, "agents", "alpha"), { recursive: true });
    await mkdir(path.join(repoDir, "agents", "beta"), { recursive: true });
    await mkdir(path.join(repoDir, "agents", "gamma"), { recursive: true });
    await writeFile(path.join(repoDir, "agents", "alpha", "index.ts"), "export const alpha = true;\n", "utf8");
    await writeFile(path.join(repoDir, "agents", "beta", "index.ts"), "export const beta = true;\n", "utf8");
    await writeFile(path.join(repoDir, "agents", "gamma", "index.ts"), "export const gamma = true;\n", "utf8");
    await writeFile(path.join(repoDir, "package.json"), '{"name":"subdir-split","version":"1.0.0"}\n', "utf8");

    let rootAgentsTimedOut = false;
    const seenScopes: string[] = [];

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: "local",
            selectedRoute: "local",
            provider: "ollama",
            model: profile === "reviewer" ? "deepseek-coder:6.7b" : "llama3.1:8b",
            profile,
            residency: "local",
            reason: "test",
            offlineCapable: true
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            return JSON.stringify({
              overview: "Retry nested directories as child scopes, not the original top-level directory.",
              tasks: [
                {
                  taskId: "risk",
                  title: "Review critical risks",
                  goal: "Inspect the scoped repository area.",
                  profile: "reviewer",
                  deliverable: "Risk findings"
                }
              ]
            });
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "Single-scope split completed.",
              summary: "A timed-out directory scope was split into smaller child scopes before retrying.",
              priorities: ["Split nested scopes before re-running them whole"],
              next_steps: ["Tune subdirectory grouping if needed"]
            });
          }

          const scopeLine = input.prompt.split("\n").find((line) => line.startsWith("Scope paths: ")) ?? "";
          const scope = scopeLine.replace("Scope paths: ", "");
          seenScopes.push(scope);

          if (scope === "agents" && !rootAgentsTimedOut) {
            rootAgentsTimedOut = true;
            throw new Error("AbortError: timeout");
          }

          return JSON.stringify({
            summary: `Processed scope ${scope}.`,
            findings: [`Checked ${scope}`],
            recommendations: [`Keep ${scope} bounded`]
          });
        }
      }
    });

    const result = await orchestrator.swarm(repoDir, outputDir, "divide scopes grandes por subdirectorios", {
      parallelism: 1,
      chunkSize: 1,
      maxQueuedTasks: 1,
      taskTimeoutMs: 1000,
      runTimeoutMs: 30_000,
      plannerTimeoutMs: 8_000,
      synthesisTimeoutMs: 8_000,
      scopeBias: "source-first"
    });

    expect(result.resilience.splitTasks).toBeGreaterThan(0);
    expect(result.workerResults.some((entry) => entry.scopePaths.includes("agents"))).toBe(false);
    expect(result.workerResults.some((entry) => entry.scopePaths.some((scopePath) => scopePath.startsWith("agents/")))).toBe(true);
    expect(seenScopes.includes("agents")).toBe(true);
    expect(seenScopes.some((scope) => scope.startsWith("agents/alpha") || scope.startsWith("agents/beta") || scope.startsWith("agents/gamma"))).toBe(
      true
    );

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Split tasks:");
  });

  it("falls back to the default planner tasks when the planner times out", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-planner-timeout");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel(input) {
          const profile = input.profile ?? "worker";
          return {
            preferredRoute: profile === "planner" ? "cloud" : "local",
            selectedRoute: profile === "planner" ? "cloud" : "local",
            provider: "ollama",
            model: profile === "planner" ? "kimi-k2.5:cloud" : "qwen2.5-coder:7b",
            profile,
            residency: profile === "planner" ? "remote" : "local",
            reason: "test",
            offlineCapable: profile !== "planner"
          };
        },
        async ask(input) {
          if (input.profile === "planner") {
            throw new Error("AbortError: timeout");
          }

          if (input.profile === "synthesizer") {
            return JSON.stringify({
              headline: "Fallback planner path completed.",
              summary: "The swarm used its fallback task plan after the planner timed out.",
              priorities: ["Keep a deterministic fallback planner"],
              next_steps: ["Tune planner timeout from real runs"]
            });
          }

          return JSON.stringify({
            summary: "Fallback worker completed.",
            findings: ["The fallback planner still produced bounded work."],
            recommendations: ["Keep deterministic fallback tasks available."]
          });
        }
      }
    });

    const result = await orchestrator.swarm(fixtureRepoPath, outputDir, "ayudame a mejorar este repo", {
      plannerTimeoutMs: 1000
    });

    expect(result.resilience.plannerTimedOut).toBe(true);
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks[0]?.taskId).toBe("scan-scope");

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Planner timed out: yes");
    expect(report).toContain("Scan project scope");
  });
});
