import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DevAgent } from "../../agents/dev_agent";
import { ContextBuilder } from "../../core/context_builder";
import { DiscoveryEngine } from "../../core/discovery_engine";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

describe("DevAgent patch proposal workflow", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("reads UX implementation tasks and generates non-applied patch proposals", async () => {
    const repoDir = await createTempOutputDir("project-brain-dev-patches-repo");
    const outputDir = await createTempOutputDir("project-brain-dev-patches-output");
    cleanupTargets.push(repoDir, outputDir);

    await writeFileEnsured(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "erp-gob-frontend",
          private: true,
          dependencies: {
            react: "^19.0.0"
          }
        },
        null,
        2
      )
    );
    await writeFileEnsured(
      path.join(repoDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            jsx: "react-jsx",
            target: "ES2022",
            module: "ESNext"
          },
          include: ["src/**/*"]
        },
        null,
        2
      )
    );
    await writeFileEnsured(path.join(repoDir, "src", "components", "Sidebar.tsx"), "export function Sidebar() { return null; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "components", "Dashboard.tsx"), "export function Dashboard() { return null; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "components", "OrderForm.tsx"), "export function OrderForm() { return null; }\n");

    const discovery = await new DiscoveryEngine().analyze(repoDir);
    const context = await new ContextBuilder().build(discovery, outputDir);

    await writeFileEnsured(
      path.join(outputDir, "UX_IMPLEMENTATION_TASKS.md"),
      `# UX Implementation Tasks

### Task
Component: Sidebar
File: src/components/Sidebar.tsx
Problem: Navigation relies on a crowded sidebar that hides the most common actions.
User impact: Users lose orientation and need extra clicks to reach core workflows.
Proposed change: Reduce sidebar depth and group navigation items around the main operator workflows.
Risk: medium
Effort: Medium

### Task
Component: Dashboard
File: src/components/Dashboard.tsx
Problem: The dashboard hierarchy makes it difficult to identify the main operational KPI at a glance.
User impact: Users cannot understand system status or priorities quickly.
Proposed change: Simplify dashboard layout and prioritize the primary KPI cards in the first viewport.
Risk: medium
Effort: Medium

### Task
Component: Forms
File: src/components/OrderForm.tsx
Problem: Several forms use technical terminology and unclear labels that increase data entry errors.
User impact: Users take longer to complete tasks and are more likely to submit incorrect data.
Proposed change: Clarify field labels, replace technical terms, and add inline helper text for complex fields.
Risk: high
Effort: Medium

### Task
Component: Sidebar
File: src/server/auth.ts
Problem: Authentication flow should be rewritten as part of the navigation cleanup.
User impact: None
Proposed change: Change server-side auth logic.
Risk: high
Effort: High
`
    );

    const report = await new DevAgent().run(context);
    const patchFiles = (await readdir(context.patchProposalDir))
      .filter((entry) => entry.endsWith(".diff"))
      .sort((left, right) => left.localeCompare(right));
    const firstPatch = await readFile(path.join(context.patchProposalDir, patchFiles[0] ?? ""), "utf8");
    const reportContent = await readFile(report.outputPath, "utf8");

    expect(report.outputPath.endsWith("dev_architecture_analysis.md")).toBe(true);
    expect(patchFiles).toEqual([
      "patch_001_form_labels.diff",
      "patch_002_sidebar_navigation.diff",
      "patch_003_dashboard_layout.diff"
    ]);
    expect(firstPatch).toContain("# Stage: PROPOSE_PATCHES");
    expect(firstPatch).toContain("# Human approval required: yes");
    expect(firstPatch).toContain("diff --git a/src/components/OrderForm.tsx b/src/components/OrderForm.tsx");
    expect(reportContent).toContain("## PROPOSE_PATCHES");
    expect(reportContent).toContain("patch_001 -> src/components/OrderForm.tsx");
    expect(existsSync(path.join(repoDir, "patch_proposals"))).toBe(false);
  });
});
