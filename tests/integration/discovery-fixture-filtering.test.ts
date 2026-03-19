import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DiscoveryEngine } from "../../core/discovery_engine";
import { cleanupDir, createTempOutputDir } from "../helpers";

describe("DiscoveryEngine fixture filtering", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("ignores nested test fixtures when inferring repository signals", async () => {
    const repoDir = await createTempOutputDir("project-brain-fixture-filter");
    cleanupTargets.push(repoDir);

    await mkdir(path.join(repoDir, "src"), { recursive: true });
    await mkdir(path.join(repoDir, "tests", "fixtures", "nested-app"), { recursive: true });
    await writeFile(
      path.join(repoDir, "package.json"),
      JSON.stringify({
        name: "real-repo",
        dependencies: {
          commander: "^14.0.0"
        },
        devDependencies: {
          vitest: "^4.0.0"
        }
      })
    );
    await writeFile(path.join(repoDir, "src", "index.ts"), "export const ready = true;\n");
    await writeFile(
      path.join(repoDir, "tests", "fixtures", "nested-app", "package.json"),
      JSON.stringify({
        name: "nested-fixture",
        dependencies: {
          react: "^19.0.0",
          express: "^5.0.0"
        }
      })
    );
    await writeFile(
      path.join(repoDir, "tests", "fixtures", "nested-app", "openapi.yaml"),
      "openapi: 3.0.0\ninfo:\n  title: Nested fixture\n  version: 1.0.0\n"
    );

    const engine = new DiscoveryEngine();
    const result = await engine.analyze(repoDir);

    expect(result.frameworks).not.toContain("React");
    expect(result.frameworks).not.toContain("Express");
    expect(result.apis).not.toContain("OpenAPI");
    expect(result.files.some((file) => file.includes("tests/fixtures"))).toBe(false);
  });
});
