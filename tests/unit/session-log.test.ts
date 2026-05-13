import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { appendError, appendLearning, updateContext } from "../../memory/session_log";
import type { ProjectContext } from "../../shared/types";
import { cleanupDir, createTempOutputDir } from "../helpers";

function makeContext(outputDir: string): ProjectContext {
  return {
    repoName: "session-log-repo",
    targetPath: outputDir,
    outputPath: outputDir,
    scannedAt: "2026-01-01T00:00:00.000Z",
    discovery: {
      repoName: "session-log-repo",
      targetPath: outputDir,
      scannedAt: "2026-01-01T00:00:00.000Z",
      files: [],
      structure: {
        topLevelDirectories: [],
        sampleFiles: [],
        subrepos: [],
        submodules: [],
        fileCount: 0,
        sourceFileCount: 0,
        testFileCount: 0
      },
      languages: [],
      frameworks: [],
      apis: [],
      infrastructure: [],
      testing: [],
      dependencies: [],
      manifests: [],
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

describe("session log", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("appends learnings idempotently", async () => {
    const outputDir = await createTempOutputDir("project-brain-session-log");
    cleanupTargets.push(outputDir);
    const context = makeContext(outputDir);

    await appendLearning(context, "Use registry workflows.");
    await appendLearning(context, "Use registry workflows.");

    const content = await readFile(path.join(context.memoryDir, "LEARNINGS.md"), "utf8");
    expect(content.match(/Use registry workflows/g)).toHaveLength(1);
  });

  it("appends errors idempotently", async () => {
    const outputDir = await createTempOutputDir("project-brain-session-error");
    cleanupTargets.push(outputDir);
    const context = makeContext(outputDir);

    await appendError(context, "2026-01-01T00:00:00.000Z [core] UNKNOWN dependency.");
    await appendError(context, "2026-01-01T00:00:00.000Z [core] UNKNOWN dependency.");

    const content = await readFile(path.join(context.memoryDir, "ERRORS.md"), "utf8");
    expect(content.match(/UNKNOWN dependency/g)).toHaveLength(1);
  });

  it("overwrites CONTEXT sections with normalized output", async () => {
    const outputDir = await createTempOutputDir("project-brain-session-context");
    cleanupTargets.push(outputDir);
    const context = makeContext(outputDir);

    await updateContext(context, {
      detected_stack: ["TypeScript", "Vitest"],
      last_command: "project-brain start"
    });
    await updateContext(context, {
      detected_stack: ["TypeScript"],
      last_command: "project-brain status"
    });

    const content = await readFile(path.join(context.memoryDir, "CONTEXT.md"), "utf8");
    expect(content).toContain("## Detected Stack");
    expect(content).toContain("- TypeScript");
    expect(content).not.toContain("- Vitest");
    expect(content).toContain("project-brain status");
  });
});
