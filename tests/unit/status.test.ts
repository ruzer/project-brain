import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { buildStatus } from "../../core/status";
import { createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("status", () => {
  it("summarizes available artifacts and writes a status snapshot", async () => {
    const outputDir = await createTempOutputDir("project-brain-status");
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
        }
      }
    });

    const context = await orchestrator.initTarget(fixtureRepoPath, outputDir);
    await mkdir(path.join(context.memoryDir, "doctor"), { recursive: true });
    await mkdir(path.join(context.memoryDir, "swarm"), { recursive: true });
    await mkdir(path.join(context.docsDir, "improvement_plan"), { recursive: true });
    await writeFile(path.join(context.memoryDir, "doctor", "doctor.json"), '{"summary":{"failed":0,"warnings":1}}\n', "utf8");
    await writeFile(path.join(context.memoryDir, "swarm", "swarm_run.json"), '{"ok":true}\n', "utf8");
    await writeFile(path.join(context.docsDir, "improvement_plan", "SUMMARY.md"), "# Summary\n", "utf8");

    const result = await buildStatus(context, {
      async runCommand(command, args) {
        const joined = `${command} ${args.join(" ")}`;
        if (joined.includes("rev-parse --is-inside-work-tree")) {
          return { ok: true, stdout: "true", stderr: "", exitCode: 0 };
        }
        if (joined.includes("branch --show-current")) {
          return { ok: true, stdout: "main", stderr: "", exitCode: 0 };
        }
        return { ok: false, stdout: "", stderr: "unexpected", exitCode: 1 };
      }
    });

    expect(result.summary.doctorStatus).toBe("warn");
    expect(result.summary.swarmStatus).toBe("available");
    expect(result.summary.planStatus).toBe("available");
    expect(result.artifacts.some((artifact) => artifact.label === "Doctor" && artifact.exists)).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.label === "Swarm" && artifact.exists)).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.label === "Re-run Doctor")).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.label === "Generate Codebase Map")).toBe(true);
    expect(result.reportPath).toContain("status.md");
    expect(result.memoryPath).toContain("status.json");
  });
});
