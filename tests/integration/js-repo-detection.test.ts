import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir } from "../helpers";
import path from "node:path";

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/express-js-repo");

describe("JavaScript repository detection", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("maps a pure JavaScript Node repository without forcing TypeScript", async () => {
    const outputDir = await createTempOutputDir("project-brain-js-repo-output");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.mapScope(fixturePath, outputDir);

    if (!("context" in result)) {
      throw new Error("Expected single repository result.");
    }

    expect(result.context.discovery.languages).toContain("JavaScript");
    expect(result.context.discovery.languages).not.toEqual(["TypeScript"]);
    expect(result.context.discovery.structure.sourceFileCount).toBeGreaterThan(0);
    expect(result.context.discovery.ecosystem).toBe("node");
  });
});
