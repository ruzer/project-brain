import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir } from "../helpers";

const fixturePath = path.resolve(process.cwd(), "tests/fixtures/express-js-repo");

describe("CommonJS impact radius", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("links CommonJS require dependents and related tests", async () => {
    const outputDir = await createTempOutputDir("project-brain-commonjs-impact-output");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.analyzeImpact(fixturePath, outputDir, {
      files: ["src/app.js"]
    });

    expect(result.impactedTests).toContain("tests/app.test.js");
    expect(result.reviewFiles).toContain("tests/app.test.js");
  });
});
