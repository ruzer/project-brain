import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiscoveryEngine } from "../../core/discovery_engine";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

describe("DiscoveryEngine integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("analyzes a simple repository fixture end-to-end", async () => {
    const engine = new DiscoveryEngine();
    const result = await engine.analyze(fixtureRepoPath);

    expect(result.repoName).toBe("sample-repo");
    expect(result.languages).toContain("TypeScript");
    expect(result.frameworks).toContain("Express");
    expect(result.apis).toContain("REST");
    expect(result.apis).toContain("OpenAPI");
    expect(result.infrastructure).toContain("Dockerfile");
    expect(result.testing).toContain("Vitest");
  });

  it("excludes generated output directories when requested", async () => {
    const repoDir = await createTempOutputDir("project-brain-discovery");
    cleanupTargets.push(repoDir);

    await mkdir(path.join(repoDir, "src"), { recursive: true });
    await mkdir(path.join(repoDir, "sample-output", "reports"), { recursive: true });
    await writeFile(path.join(repoDir, "package.json"), JSON.stringify({ name: "temp-repo", dependencies: { express: "1.0.0" } }));
    await writeFile(path.join(repoDir, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(path.join(repoDir, "sample-output", "reports", "noise.ts"), "export const noise = 1;\n");

    const engine = new DiscoveryEngine();
    const result = await engine.analyze(repoDir, { excludePaths: ["sample-output"] });

    expect(result.files).toContain("src/index.ts");
    expect(result.files).not.toContain("sample-output/reports/noise.ts");
  });

  it("ignores project-brain root artifacts without hiding source memory modules", async () => {
    const repoDir = await createTempOutputDir("project-brain-generated-artifacts");
    cleanupTargets.push(repoDir);

    await mkdir(path.join(repoDir, "src"), { recursive: true });
    await mkdir(path.join(repoDir, "AI_CONTEXT"), { recursive: true });
    await mkdir(path.join(repoDir, "reports"), { recursive: true });
    await mkdir(path.join(repoDir, "tasks", "packets"), { recursive: true });
    await mkdir(path.join(repoDir, "memory", "memory_brief"), { recursive: true });
    await writeFile(path.join(repoDir, "package.json"), JSON.stringify({ name: "temp-repo" }));
    await writeFile(path.join(repoDir, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(path.join(repoDir, "AI_CONTEXT", "noise.ts"), "export const noise = 1;\n");
    await writeFile(path.join(repoDir, "reports", "noise.ts"), "export const noise = 1;\n");
    await writeFile(path.join(repoDir, "tasks", "packets", "noise.ts"), "export const noise = 1;\n");
    await writeFile(path.join(repoDir, "memory", "memory_brief", "memory_brief.json"), "{}\n");

    const result = await new DiscoveryEngine().analyze(repoDir);

    expect(result.files).toContain("src/index.ts");
    expect(result.files).not.toContain("AI_CONTEXT/noise.ts");
    expect(result.files).not.toContain("reports/noise.ts");
    expect(result.files).not.toContain("tasks/packets/noise.ts");
    expect(result.structure.topLevelDirectories).not.toContain("memory");
  });

  it("keeps a real source memory directory when it is not project-brain runtime output", async () => {
    const repoDir = await createTempOutputDir("project-brain-source-memory");
    cleanupTargets.push(repoDir);

    await mkdir(path.join(repoDir, "memory", "context_store"), { recursive: true });
    await writeFile(path.join(repoDir, "package.json"), JSON.stringify({ name: "temp-repo" }));
    await writeFile(path.join(repoDir, "memory", "context_store", "index.ts"), "export const source = true;\n");

    const result = await new DiscoveryEngine().analyze(repoDir);

    expect(result.files).toContain("memory/context_store/index.ts");
    expect(result.structure.topLevelDirectories).toContain("memory");
  });
});
