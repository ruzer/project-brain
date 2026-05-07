import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { appendFileEnsured, writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function seedRepo(repoDir: string): Promise<void> {
  await writeFileEnsured(
    path.join(repoDir, "package.json"),
    JSON.stringify(
      {
        name: "fact-query-fixture",
        private: true,
        dependencies: {
          commander: "^14.0.1"
        }
      },
      null,
      2
    )
  );
  await writeFileEnsured(path.join(repoDir, "src", "swarm_runtime.ts"), "export function askWithSwarmCache() { return 'cached'; }\n");
}

describe("fact query", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("queries memory brief and repository fact graph without model calls", async () => {
    const repoDir = await createTempOutputDir("project-brain-fact-query-repo");
    const outputDir = await createTempOutputDir("project-brain-fact-query-output");
    cleanupTargets.push(repoDir, outputDir);

    await seedRepo(repoDir);

    const orchestrator = new ProjectBrainOrchestrator();
    await orchestrator.buildCodeGraph(repoDir, outputDir);
    const context = await orchestrator.initTarget(repoDir, outputDir);
    await appendFileEnsured(
      path.join(context.memoryDir, "DECISIONS.md"),
      "\n- Use swarm cache policy before model execution because cache keys must reflect prompt policy.\n"
    );
    await orchestrator.status(repoDir, outputDir);

    const result = await orchestrator.factQuery(repoDir, outputDir, "swarm cache policy");

    await access(result.reportPath);
    await access(result.memoryPath);
    expect(result.answer).toContain("FOUND");
    expect(result.memoryMatches.some((match) => /swarm cache policy/i.test(match.text))).toBe(true);
    expect(result.nodeMatches.some((match) => match.label.includes("swarm_runtime"))).toBe(true);
    expect(result.evidenceRefs.some((ref) => ref.includes("src/swarm_runtime.ts"))).toBe(true);

    const persisted = JSON.parse(await readFile(result.memoryPath, "utf8")) as { answer?: string };
    expect(persisted.answer).toBe(result.answer);
  });
});
