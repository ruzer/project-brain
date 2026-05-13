import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { classifySensitiveFileExposure } from "../../agents/security_agent";
import type { DiscoveryResult, ProjectContext } from "../../shared/types";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

function git(repoDir: string, args: string[]): void {
  execFileSync("git", ["-C", repoDir, ...args], {
    stdio: "ignore"
  });
}

function makeContext(targetPath: string, outputPath: string): ProjectContext {
  const discovery: DiscoveryResult = {
    repoName: "security-env-fixture",
    targetPath,
    scannedAt: "2026-01-01T00:00:00.000Z",
    files: [".env"],
    structure: {
      topLevelDirectories: [],
      sampleFiles: [".env"],
      subrepos: [],
      submodules: [],
      fileCount: 1,
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
    git: { isGitRepo: true, hasSubmodules: false },
    ci: { providers: [], configFiles: [] },
    logging: { frameworks: [], configFiles: [], structured: false },
    metrics: { tools: [], configFiles: [], alertsConfigured: false },
    recommendations: []
  };

  return {
    repoName: discovery.repoName,
    targetPath,
    outputPath,
    scannedAt: discovery.scannedAt,
    discovery,
    memoryDir: path.join(outputPath, "AI_CONTEXT"),
    reportsDir: path.join(outputPath, "reports"),
    docsDir: path.join(outputPath, "docs"),
    runtimeMemoryDir: path.join(outputPath, "memory"),
    learningDir: path.join(outputPath, "memory", "learnings"),
    taskBoardDir: path.join(outputPath, "tasks"),
    proposalDir: path.join(outputPath, "proposal"),
    patchProposalDir: path.join(outputPath, "patch_proposals")
  };
}

describe("security env classification", () => {
  it("classifies ignored working-tree .env files as untracked", async () => {
    const repoDir = await createTempOutputDir("project-brain-env-untracked-repo");
    const outputDir = await createTempOutputDir("project-brain-env-untracked-output");

    try {
      git(repoDir, ["init"]);
      await writeFileEnsured(path.join(repoDir, ".gitignore"), ".env\n");
      await writeFileEnsured(path.join(repoDir, ".env"), "SECRET=value\n");

      const exposure = await classifySensitiveFileExposure(makeContext(repoDir, outputDir), ".env");

      expect(exposure.category).toBe("SECRET_PRESENT_UNTRACKED");
      expect(exposure.severity).toBe("low");
    } finally {
      await cleanupDir(repoDir);
      await cleanupDir(outputDir);
    }
  });

  it("classifies committed .env files as tracked secrets", async () => {
    const repoDir = await createTempOutputDir("project-brain-env-tracked-repo");
    const outputDir = await createTempOutputDir("project-brain-env-tracked-output");

    try {
      git(repoDir, ["init"]);
      git(repoDir, ["config", "user.name", "Project Brain"]);
      git(repoDir, ["config", "user.email", "project-brain@example.com"]);
      await writeFileEnsured(path.join(repoDir, ".env"), "SECRET=value\n");
      git(repoDir, ["add", ".env"]);
      git(repoDir, ["commit", "-m", "track env fixture"]);

      const exposure = await classifySensitiveFileExposure(makeContext(repoDir, outputDir), ".env");

      expect(exposure.category).toBe("SECRET_TRACKED");
      expect(exposure.severity).toBe("high");
    } finally {
      await cleanupDir(repoDir);
      await cleanupDir(outputDir);
    }
  });
});
