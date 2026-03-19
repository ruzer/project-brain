import { access, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

function git(repoDir: string, args: string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

async function seedImpactRepo(repoDir: string): Promise<void> {
  await writeFileEnsured(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "impact-radius-fixture",
        private: true,
        type: "module"
      },
      null,
      2
    )
  );
  await writeFileEnsured(path.join(repoDir, "src", "shared.ts"), "export const shared = 'base';\n");
  await writeFileEnsured(path.join(repoDir, "src", "service.ts"), "import { shared } from './shared';\nexport const service = `${shared}:service`;\n");
  await writeFileEnsured(path.join(repoDir, "src", "app.ts"), "import { service } from './service';\nexport const app = `${service}:app`;\n");
  await writeFileEnsured(path.join(repoDir, "src", "consumer.ts"), "import { shared } from './shared';\nexport const consumer = `${shared}:consumer`;\n");
  await writeFileEnsured(
    path.join(repoDir, "tests", "app.test.ts"),
    "import { app } from '../src/app';\nexport const smoke = () => app;\n"
  );
}

describe("Impact radius integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("builds a local import graph and computes a review set from explicit files", async () => {
    const repoDir = await createTempOutputDir("project-brain-impact-repo");
    const outputDir = await createTempOutputDir("project-brain-impact-output");
    cleanupTargets.push(repoDir, outputDir);

    await seedImpactRepo(repoDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.analyzeImpact(repoDir, outputDir, {
      files: ["src/shared.ts"]
    });

    await access(result.graphPath);
    await access(result.reportPath);

    const reportContent = await readFile(result.reportPath, "utf8");
    const graphDocument = JSON.parse(await readFile(result.graphPath, "utf8")) as {
      version: number;
      nodes: string[];
      edges: Array<{ kind: string; from: string; to: string }>;
      symbols: Array<{ id: string; kind: string }>;
      build: { mode: string };
      stats: { symbols: number };
    };

    expect(result.graphPath.endsWith("code_graph_v2.json")).toBe(true);
    expect(result.changedFiles).toEqual(["src/shared.ts"]);
    expect(result.directDependents).toEqual(["src/consumer.ts", "src/service.ts"]);
    expect(result.transitiveDependents).toEqual(["src/app.ts"]);
    expect(result.impactedTests).toEqual(["tests/app.test.ts"]);
    expect(result.reviewFiles).toEqual([
      "src/app.ts",
      "src/consumer.ts",
      "src/service.ts",
      "src/shared.ts",
      "tests/app.test.ts"
    ]);
    expect(graphDocument.version).toBe(2);
    expect(graphDocument.build.mode).toBe("full");
    expect(result.graphStats.nodes).toBe(graphDocument.nodes.length);
    expect(result.graphStats.symbols).toBe(graphDocument.stats.symbols);
    expect(graphDocument.edges.some((edge) => edge.kind === "imports" && edge.from === "src/service.ts" && edge.to === "src/shared.ts")).toBe(true);
    expect(graphDocument.symbols.some((symbol) => symbol.id === "src/service.ts#service" && symbol.kind === "variable")).toBe(true);
    expect(reportContent).toContain("## Direct Dependents");
    expect(reportContent).toContain("tests/app.test.ts");
  });

  it("derives changed files from git history for review-delta", async () => {
    const repoDir = await createTempOutputDir("project-brain-review-delta-repo");
    const outputDir = await createTempOutputDir("project-brain-review-delta-output");
    cleanupTargets.push(repoDir, outputDir);

    await seedImpactRepo(repoDir);

    git(repoDir, ["init"]);
    git(repoDir, ["config", "user.name", "Project Brain"]);
    git(repoDir, ["config", "user.email", "project-brain@example.com"]);
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial graph"]);

    await writeFileEnsured(path.join(repoDir, "src", "shared.ts"), "export const shared = 'changed';\n");
    git(repoDir, ["add", "src/shared.ts"]);
    git(repoDir, ["commit", "-m", "change shared module"]);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.reviewDelta(repoDir, outputDir);
    const graphDocument = JSON.parse(await readFile(result.graphPath, "utf8")) as {
      build: { mode: string; updatedFiles: string[] };
    };

    expect(result.changedFiles).toEqual(["src/shared.ts"]);
    expect(result.directDependents).toEqual(["src/consumer.ts", "src/service.ts"]);
    expect(result.transitiveDependents).toEqual(["src/app.ts"]);
    expect(result.impactedTests).toEqual(["tests/app.test.ts"]);
    expect(result.reviewFiles).toContain("src/shared.ts");
    expect(result.reviewFiles).toContain("tests/app.test.ts");
    expect(["full", "incremental"]).toContain(graphDocument.build.mode);
    expect(graphDocument.build.updatedFiles).toContain("src/shared.ts");
  });
});
