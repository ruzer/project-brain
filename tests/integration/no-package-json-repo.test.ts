import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir } from "../helpers";

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/no-package-json-repo");

describe("Repository detection without package.json", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("maps a non-Node repository without throwing or forcing TypeScript", async () => {
    const outputDir = await createTempOutputDir("project-brain-no-package-output");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.mapScope(fixturePath, outputDir);

    if (!("context" in result)) {
      throw new Error("Expected single repository result.");
    }

    expect(result.context.discovery.languages).toContain("Python");
    expect(result.context.discovery.languages).not.toContain("TypeScript");
    expect(result.context.discovery.structure.sourceFileCount).toBeGreaterThan(0);
  });
});
