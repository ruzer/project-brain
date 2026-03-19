import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Agent report quality gating", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("marks vague reports for review and keeps grounded reports in downstream memory and risk summaries", async () => {
    const outputDir = await createTempOutputDir("project-brain-report-quality");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const now = new Date().toISOString();

    (orchestrator as any).selfGovernance = {
      async run(context: { reportsDir: string }) {
        const groundedReportPath = path.join(context.reportsDir, "grounded_agent.md");
        const vagueReportPath = path.join(context.reportsDir, "vague_agent.md");

        await Promise.all([
          writeFile(
            groundedReportPath,
            "# Grounded Report\n\n- Evidence: `src/index.ts`\n- Recommendation: add a smoke test for `src/index.ts`.\n",
            "utf8"
          ),
          writeFile(
            vagueReportPath,
            "# Vague Report\n\n- Improve the UX across the platform.\n- Refactor the architecture.\n",
            "utf8"
          )
        ]);

        return {
          agentReports: [
            {
              agentId: "grounded-agent",
              title: "Grounded Report",
              summary: "The login entrypoint in src/index.ts should have a smoke test.",
              findings: ["Missing regression coverage around src/index.ts."],
              recommendations: ["Add a smoke test for src/index.ts before release validation."],
              riskLevel: "medium",
              outputPath: groundedReportPath
            },
            {
              agentId: "vague-agent",
              title: "Vague Report",
              summary: "Improve the platform architecture and UX.",
              findings: ["Improve the UX across the platform."],
              recommendations: ["Refactor the architecture."],
              riskLevel: "high",
              outputPath: vagueReportPath
            }
          ],
          summary: {
            trigger: "manual",
            tasks: [],
            messages: [],
            evaluations: [],
            learnings: [],
            proposals: [],
            executionRecords: [
              {
                agentId: "grounded-agent",
                taskId: "task-grounded",
                startedAt: now,
                completedAt: now,
                status: "completed"
              },
              {
                agentId: "vague-agent",
                taskId: "task-vague",
                startedAt: now,
                completedAt: now,
                status: "completed"
              }
            ],
            agentActivityReportPath: path.join(context.reportsDir, "agent_activity_report.md"),
            improvementReportPath: path.join(context.reportsDir, "improvement_report.md")
          }
        };
      }
    };

    const result = await orchestrator.analyzeTarget(fixtureRepoPath, outputDir, "manual");
    const qualityReport = await readFile(result.reportQualityPath!, "utf8");
    const riskReport = await readFile(result.riskReportPath, "utf8");
    const memoryTasks = await readFile(path.join(outputDir, "AI_CONTEXT", "TASKS.md"), "utf8");

    expect(qualityReport).toContain("Accepted reports: 1");
    expect(qualityReport).toContain("Review-required reports: 1");
    expect(qualityReport).toContain("grounded-agent");
    expect(qualityReport).toContain("vague-agent");
    expect(qualityReport).toContain("src/index.ts");
    expect(qualityReport).toContain("No cita archivos o superficies confirmadas del repositorio.");

    expect(riskReport).toContain("Missing regression coverage around src/index.ts.");
    expect(riskReport).not.toContain("Improve the UX across the platform.");

    expect(memoryTasks).toContain("Add a smoke test for src/index.ts before release validation.");
    expect(memoryTasks).not.toContain("Refactor the architecture.");
  });
});
