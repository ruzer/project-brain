import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir } from "../helpers";

describe("Project seed integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("creates AI_CONTEXT and project seed artifacts for a new project", async () => {
    const parentDir = await createTempOutputDir("project-brain-new-project");
    cleanupTargets.push(parentDir);
    const targetDir = path.join(parentDir, "inventory-saas");
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.scaffoldProject(targetDir, {
      projectName: "Inventory SaaS",
      problem: "Small workshops need to track inventory and orders in one place.",
      audience: "Small repair workshops",
      archetype: "saas-webapp",
      stackPreference: "Next.js + PostgreSQL",
      features: ["inventory dashboard", "order tracking"],
      authRequired: true,
      roles: ["owner", "technician"],
      dataEntities: ["User", "Workshop", "InventoryItem", "Order"],
      integrations: ["email", "object storage"],
      priority: "solid-architecture",
      language: "es",
      notes: ["MVP should avoid payments at first"],
      contextOnly: true
    });

    await access(result.artifactPaths.projectCharterPath);
    await access(result.artifactPaths.requirementsPath);
    await access(result.artifactPaths.blueprintPath);
    await access(result.artifactPaths.projectSeedMemoryPath);
    await access(result.artifactPaths.backlogPath);
    await access(result.artifactPaths.claudePath);

    const blueprint = await readFile(result.artifactPaths.blueprintPath, "utf8");
    const claudeContext = await readFile(result.artifactPaths.claudePath, "utf8");
    const memory = JSON.parse(await readFile(result.artifactPaths.projectSeedMemoryPath, "utf8")) as {
      input: { projectName: string; archetype: string };
    };

    expect(blueprint).toContain("## 9. Build Order");
    expect(blueprint).toContain("## Coding Discipline");
    expect(claudeContext).toContain("Prefer the smallest implementation");
    expect(blueprint).toContain("Next.js + PostgreSQL");
    expect(memory.input.projectName).toBe("Inventory SaaS");
    expect(memory.input.archetype).toBe("saas-webapp");
  });

  it("refuses to overwrite project seed artifacts unless requested", async () => {
    const targetDir = await createTempOutputDir("project-brain-new-overwrite");
    cleanupTargets.push(targetDir);
    const orchestrator = new ProjectBrainOrchestrator();
    const input = {
      projectName: "Overwrite Guard",
      problem: "Prevent accidental context replacement.",
      audience: "Maintainers",
      archetype: "custom" as const,
      stackPreference: "",
      features: [],
      authRequired: false,
      roles: [],
      dataEntities: [],
      integrations: [],
      priority: "mvp-fast" as const,
      language: "es",
      notes: [],
      contextOnly: true
    };

    await orchestrator.scaffoldProject(targetDir, input);

    await expect(orchestrator.scaffoldProject(targetDir, input)).rejects.toThrow("Refusing to overwrite");
  });
});
