import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { buildResume } from "../../core/resume";
import type { StatusResult } from "../../shared/types";
import { createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("resume", () => {
  it("recovers the latest artifact stage and suggests the next control-tower step", async () => {
    const outputDir = await createTempOutputDir("project-brain-resume");

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
    await writeFile(
      path.join(context.memoryDir, "doctor", "doctor.json"),
      JSON.stringify({
        summary: {
          passed: 10,
          warnings: 0,
          failed: 0,
          headline: "Doctor found no failing checks."
        }
      }),
      "utf8"
    );
    await writeFile(
      path.join(context.memoryDir, "swarm", "swarm_run.json"),
      JSON.stringify({
        resilience: {
          runTimedOut: true,
          timedOutTasks: 3
        },
        synthesis: {
          headline: "The swarm found real next steps.",
          summary: "Bounded delegated analysis completed with a partial result."
        }
      }),
      "utf8"
    );

    const statusResult: StatusResult = {
      context,
      reportPath: path.join(context.reportsDir, "status.md"),
      memoryPath: path.join(context.memoryDir, "status", "status.json"),
      git: {
        isGitRepo: true,
        branch: "main"
      },
      summary: {
        headline: "Status snapshot: doctor=pass, swarm=available, plan=missing, artifacts=2",
        artifactCount: 2,
        doctorStatus: "pass",
        swarmStatus: "available",
        planStatus: "missing"
      },
      artifacts: [
        {
          label: "Ask Brief",
          path: path.join(context.reportsDir, "ask_brief.md"),
          exists: true,
          updatedAt: "2026-03-18T10:06:00.000Z"
        },
        {
          label: "Doctor",
          path: path.join(context.memoryDir, "doctor", "doctor.json"),
          exists: true,
          updatedAt: "2026-03-18T10:00:00.000Z"
        },
        {
          label: "Swarm",
          path: path.join(context.memoryDir, "swarm", "swarm_run.json"),
          exists: true,
          updatedAt: "2026-03-18T10:05:00.000Z"
        },
        {
          label: "Improvement Plan",
          path: path.join(context.docsDir, "improvement_plan", "SUMMARY.md"),
          exists: false
        }
      ],
      suggestions: []
    };

    const result = await buildResume(context, {
      async buildStatus() {
        return statusResult;
      }
    });

    expect(result.summary.stage).toBe("swarm");
    expect(result.summary.latestArtifactLabel).toBe("Swarm");
    expect(result.notes.some((note) => note.includes("The swarm found real next steps."))).toBe(true);
    expect(result.notes.some((note) => note.includes("global time budget"))).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.label === "Continue With Improvement Plan")).toBe(true);
    expect(result.reportPath).toContain("resume.md");
    expect(result.memoryPath).toContain("resume.json");
  });
});
