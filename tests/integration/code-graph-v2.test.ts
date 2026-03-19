import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function seedGraphRepo(repoDir: string): Promise<void> {
  await writeFileEnsured(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "code-graph-v2-fixture",
        private: true,
        type: "module"
      },
      null,
      2
    )
  );
  await writeFileEnsured(path.join(repoDir, "src", "shared.ts"), "export const shared = 'base';\n");
  await writeFileEnsured(
    path.join(repoDir, "src", "service.ts"),
    "import { shared } from './shared';\nexport function service() { return shared; }\n"
  );
  await writeFileEnsured(
    path.join(repoDir, "src", "app.ts"),
    "import { service } from './service';\nexport function app() { return service(); }\n"
  );
}

describe("Code graph v2 integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("builds a persistent symbol-aware graph and updates incrementally", async () => {
    const repoDir = await createTempOutputDir("project-brain-graph-v2-repo");
    const outputDir = await createTempOutputDir("project-brain-graph-v2-output");
    cleanupTargets.push(repoDir, outputDir);

    await seedGraphRepo(repoDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const firstBuild = await orchestrator.buildCodeGraph(repoDir, outputDir);

    await access(firstBuild.graphPath);

    expect(firstBuild.graph.build.mode).toBe("full");
    expect(firstBuild.graph.stats.files).toBe(3);
    expect(firstBuild.graph.stats.symbols).toBeGreaterThanOrEqual(3);
    expect(firstBuild.graph.edges.some((edge) => edge.kind === "imports" && edge.from === "src/app.ts" && edge.to === "src/service.ts")).toBe(true);
    expect(firstBuild.graph.symbols.some((symbol) => symbol.id === "src/service.ts#service" && symbol.kind === "function")).toBe(true);

    await writeFileEnsured(
      path.join(repoDir, "src", "service.ts"),
      "import { shared } from './shared';\nexport function service() { return `${shared}:updated`; }\n"
    );

    const secondBuild = await orchestrator.buildCodeGraph(repoDir, outputDir);
    const persisted = JSON.parse(await readFile(secondBuild.graphPath, "utf8")) as {
      build: { mode: string; updatedFiles: string[] };
      stats: { files: number; symbols: number };
    };

    expect(secondBuild.graph.build.mode).toBe("incremental");
    expect(secondBuild.graph.build.updatedFiles).toEqual(["src/service.ts"]);
    expect(persisted.build.mode).toBe("incremental");
    expect(persisted.build.updatedFiles).toEqual(["src/service.ts"]);
    expect(persisted.stats.files).toBe(3);
    expect(persisted.stats.symbols).toBeGreaterThanOrEqual(3);
  });
});
