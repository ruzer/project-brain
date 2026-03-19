import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import type { ImprovementPlanResult, ResumeResult } from "../../shared/types";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("Ask intent routing", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("routes discovery-style prompts into repository mapping", async () => {
    const outputDir = await createTempOutputDir("project-brain-ask-discover");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.ask(fixtureRepoPath, outputDir, "identifica este proyecto");

    expect(result.workflow).toBe("discover-project");
    expect(result.artifacts.some((artifact) => artifact.label === "Codebase map summary")).toBe(true);
    await access(result.briefPath);

    const brief = await readFile(result.briefPath, "utf8");
    expect(brief).toContain("discover-project");
    expect(brief).toContain("Codebase map summary");
  });

  it("routes policy prompts into firewall inspection", async () => {
    const outputDir = await createTempOutputDir("project-brain-ask-firewall");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.ask(fixtureRepoPath, outputDir, "inspecciona el firewall y aprobaciones");

    expect(result.workflow).toBe("inspect-firewall");
    expect(result.artifacts.some((artifact) => artifact.label === "Firewall report")).toBe(true);
    await access(result.briefPath);

    const brief = await readFile(result.briefPath, "utf8");
    expect(brief).toContain("inspect-firewall");
    expect(brief).toContain("Firewall report");
  });

  it("can enrich strategic ask flows with the planner model", async () => {
    const outputDir = await createTempOutputDir("project-brain-ask-ai");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator({
      aiRouter: {
        async selectModel() {
          return {
            preferredRoute: "cloud",
            selectedRoute: "cloud",
            provider: "ollama",
            model: "kimi-k2.5:cloud",
            profile: "planner",
            residency: "remote",
            reason: "Strategic ask uses planner model.",
            offlineCapable: false
          };
        },
        async ask() {
          return JSON.stringify({
            headline: "Interpreted the request as a strategic project definition flow.",
            summary: ["The request should branch into discovery first and then critical gap analysis."],
            follow_ups: ['project-brain ask "dime que le falta criticamente"'],
            suggested_workflow: "discover-project"
          });
        }
      }
    });

    const result = await orchestrator.ask(fixtureRepoPath, outputDir, "quiero definir bien el stack y el alcance de este proyecto");

    expect(result.workflow).toBe("discover-project");
    expect(result.aiAssistance?.model).toBe("kimi-k2.5:cloud");
    expect(result.aiAssistance?.profile).toBe("planner");

    const brief = await readFile(result.briefPath, "utf8");
    expect(brief).toContain("kimi-k2.5:cloud");
    expect(brief).toContain("AI Assist");
  });

  it("routes continuation prompts into resume-aware recovery", async () => {
    const outputDir = await createTempOutputDir("project-brain-ask-resume");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();
    const context = await orchestrator.initTarget(fixtureRepoPath, outputDir);
    const resumeReportPath = path.join(context.reportsDir, "resume.md");
    const swarmPath = path.join(context.memoryDir, "swarm", "swarm_run.json");
    const planSummaryPath = path.join(context.docsDir, "improvement_plan", "SUMMARY.md");
    const roadmapPath = path.join(context.docsDir, "improvement_plan", "ROADMAP.md");

    await mkdir(path.dirname(swarmPath), { recursive: true });
    await mkdir(path.dirname(planSummaryPath), { recursive: true });
    await writeFile(resumeReportPath, "# Resume\n", "utf8");
    await writeFile(swarmPath, '{"ok":true}\n', "utf8");
    await writeFile(planSummaryPath, "# Improvement Plan Summary\n", "utf8");
    await writeFile(roadmapPath, "# Roadmap\n", "utf8");

    orchestrator.resume = async () =>
      ({
        context,
        reportPath: resumeReportPath,
        memoryPath: path.join(context.memoryDir, "resume", "resume.json"),
        git: {
          isGitRepo: true,
          branch: "main"
        },
        summary: {
          headline: "Resume from Swarm: The swarm already found concrete next steps.",
          stage: "swarm",
          artifactCount: 1,
          latestArtifactLabel: "Swarm",
          latestArtifactUpdatedAt: "2026-03-18T10:05:00.000Z"
        },
        latestArtifact: {
          label: "Swarm",
          path: swarmPath,
          exists: true,
          updatedAt: "2026-03-18T10:05:00.000Z"
        },
        artifacts: [
          {
            label: "Swarm",
            path: swarmPath,
            exists: true,
            updatedAt: "2026-03-18T10:05:00.000Z"
          }
        ],
        notes: [
          "Latest artifact: Swarm at 2026-03-18T10:05:00.000Z.",
          "The swarm already found concrete next steps."
        ],
        suggestions: [
          {
            label: "Continue With Improvement Plan",
            command: `project-brain plan-improvements . --output "${outputDir}"`,
            rationale: "Convert the swarm findings into a persistent roadmap.",
            priority: "high"
          }
        ]
      }) satisfies ResumeResult;

    orchestrator.planImprovements = async () =>
      ({
        context,
        planDir: path.join(context.docsDir, "improvement_plan"),
        summaryPath: planSummaryPath,
        statePath: path.join(context.docsDir, "improvement_plan", "STATE.md"),
        risksPath: path.join(context.docsDir, "improvement_plan", "KNOWN_RISKS.md"),
        roadmapPath,
        tracksPath: path.join(context.docsDir, "improvement_plan", "TRACKS.md")
      }) satisfies ImprovementPlanResult;

    const result = await orchestrator.ask(fixtureRepoPath, outputDir, "continua con el proyecto");

    expect(result.workflow).toBe("resume-project");
    expect(result.artifacts.some((artifact) => artifact.label === "Resume report")).toBe(true);
    expect(result.artifacts.some((artifact) => artifact.label === "Improvement plan summary")).toBe(true);
    expect(result.summary.some((line) => line.includes("Recovered stage: swarm"))).toBe(true);
    expect(result.guidedExecution?.label).toBe("Improvement Plan");
    expect(result.guidedExecution?.command).toContain("plan-improvements");
    expect(result.followUps.some((step) => step.includes("review-delta"))).toBe(true);

    const brief = await readFile(result.briefPath, "utf8");
    expect(brief).toContain("resume-project");
    expect(brief).toContain("Resume report");
    expect(brief).toContain("Recovered stage: swarm");
    expect(brief).toContain("Guided continuation");
    expect(brief).toContain("Improvement Plan");
  });

  it("continues from an improvement plan into review-delta when the user asks to continue", async () => {
    const outputDir = await createTempOutputDir("project-brain-ask-resume-plan");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();
    const context = await orchestrator.initTarget(fixtureRepoPath, outputDir);
    const resumeReportPath = path.join(context.reportsDir, "resume.md");
    const planSummaryPath = path.join(context.docsDir, "improvement_plan", "SUMMARY.md");
    const impactReportPath = path.join(context.reportsDir, "impact_radius.md");
    const graphPath = path.join(context.runtimeMemoryDir, "code_graph", "import_graph.json");

    await mkdir(path.dirname(planSummaryPath), { recursive: true });
    await mkdir(path.dirname(graphPath), { recursive: true });
    await writeFile(resumeReportPath, "# Resume\n", "utf8");
    await writeFile(planSummaryPath, "# Improvement Plan Summary\n", "utf8");
    await writeFile(impactReportPath, "# Impact Radius\n", "utf8");
    await writeFile(graphPath, '{"ok":true}\n', "utf8");

    orchestrator.resume = async () =>
      ({
        context,
        reportPath: resumeReportPath,
        memoryPath: path.join(context.memoryDir, "resume", "resume.json"),
        git: {
          isGitRepo: true,
          branch: "main"
        },
        summary: {
          headline: "Resume from Improvement Plan: a persistent roadmap already exists for this output path.",
          stage: "plan-improvements",
          artifactCount: 1,
          latestArtifactLabel: "Improvement Plan",
          latestArtifactUpdatedAt: "2026-03-18T10:10:00.000Z"
        },
        latestArtifact: {
          label: "Improvement Plan",
          path: planSummaryPath,
          exists: true,
          updatedAt: "2026-03-18T10:10:00.000Z"
        },
        artifacts: [
          {
            label: "Improvement Plan",
            path: planSummaryPath,
            exists: true,
            updatedAt: "2026-03-18T10:10:00.000Z"
          }
        ],
        notes: [
          "Latest artifact: Improvement Plan at 2026-03-18T10:10:00.000Z.",
          "A persistent roadmap already exists for this output path."
        ],
        suggestions: [
          {
            label: "Review Latest Changes",
            command: `project-brain review-delta . --output "${outputDir}"`,
            rationale: "The next useful checkpoint is a bounded review of recent changes.",
            priority: "medium"
          }
        ]
      }) satisfies ResumeResult;

    orchestrator.reviewDelta = async () => ({
      targetPath: fixtureRepoPath,
      outputPath: outputDir,
      changedFiles: ["core/orchestrator/main.ts"],
      directDependents: ["core/resume/index.ts"],
      transitiveDependents: ["cli/project-brain.ts"],
      reviewFiles: ["core/orchestrator/main.ts", "core/resume/index.ts"],
      impactedTests: ["tests/integration/ask-intent-routing.test.ts"],
      unresolvedImports: [],
      graphPath,
      reportPath: impactReportPath,
      graphStats: {
        nodes: 12,
        edges: 18,
        files: 4,
        symbols: 7,
        buildMode: "incremental",
        updatedFiles: 1
      }
    });

    const result = await orchestrator.ask(fixtureRepoPath, outputDir, "retoma donde nos quedamos");

    expect(result.workflow).toBe("resume-project");
    expect(result.guidedExecution?.label).toBe("Review Delta");
    expect(result.guidedExecution?.command).toContain("review-delta");
    expect(result.artifacts.some((artifact) => artifact.label === "Impact report")).toBe(true);
    expect(result.followUps.some((step) => step.includes("status"))).toBe(true);

    const brief = await readFile(result.briefPath, "utf8");
    expect(brief).toContain("Continued from Improvement Plan into Review Delta.");
    expect(brief).toContain("Impact report");
  });
});
