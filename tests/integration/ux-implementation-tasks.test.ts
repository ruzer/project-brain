import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UXImprovementAgent } from "../../agents/ux_improvement_agent";
import { ContextBuilder } from "../../core/context_builder";
import { DiscoveryEngine } from "../../core/discovery_engine";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

const originalTimeout = process.env.OLLAMA_TIMEOUT_MS;

describe("UX implementation task generation", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    if (originalTimeout === undefined) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = originalTimeout;
    }

    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("converts UX findings into actionable frontend implementation tasks", async () => {
    const repoDir = await createTempOutputDir("workflow-frontend-fixture");
    const outputDir = await createTempOutputDir("project-brain-ux-tasks");
    cleanupTargets.push(repoDir, outputDir);

    await writeFileEnsured(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "workflow-frontend",
          dependencies: {
            react: "^19.0.0"
          }
        },
        null,
        2
      )
    );
    await writeFileEnsured(path.join(repoDir, "src", "components", "Sidebar.tsx"), "export function Sidebar() { return null; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "components", "OrderForm.tsx"), "export function OrderForm() { return null; }\n");
    await writeFileEnsured(
      path.join(repoDir, "src", "components", "WorkspaceShell.tsx"),
      "export function WorkspaceShell() { return null; }\n"
    );
    await writeFileEnsured(path.join(repoDir, "src", "components", "DataTable.tsx"), "export function DataTable() { return null; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "components", "SearchBar.tsx"), "export function SearchBar() { return null; }\n");

    process.env.OLLAMA_TIMEOUT_MS = "1";

    const discovery = await new DiscoveryEngine().analyze(repoDir);
    const context = await new ContextBuilder().build(discovery, outputDir);

    await writeFileEnsured(
      path.join(context.reportsDir, "usability_findings.md"),
      `# Frontend Usability Findings

## Main usability problems
- The README onboarding guide is missing and new developers may need more setup instructions.
- Navigation relies on a crowded sidebar that hides the most common actions.
- Several forms use technical terminology and unclear labels that increase data entry errors.

## Recommendations
1. Add a better onboarding guide for developers.
2. Reduce sidebar depth and group navigation items around the main operator workflows.
3. Simplify forms, clarify field labels, and add inline helper text for complex fields.
`
    );
    await writeFileEnsured(
      path.join(context.reportsDir, "workflow_analysis.md"),
      `# Workflow Analysis

## Workflow issues
- The workspace flow forces users to jump between screens before they can complete a record review.

## Action items
1. Reorganize the workspace so related steps and actions stay in one screen.
`
    );

    const report = await new UXImprovementAgent().run(context);
    const tasksPath = path.join(outputDir, "UX_IMPLEMENTATION_TASKS.md");
    const navigationPath = path.join(outputDir, "NAVIGATION_RESTRUCTURE.md");
    const formsPath = path.join(outputDir, "FORM_SIMPLIFICATION_TASKS.md");
    const workspacePath = path.join(outputDir, "WORKSPACE_IMPROVEMENTS.md");
    const content = await readFile(tasksPath, "utf8");
    const navigationContent = await readFile(navigationPath, "utf8");
    const formContent = await readFile(formsPath, "utf8");
    const workspaceContent = await readFile(workspacePath, "utf8");

    expect(report.outputPath.endsWith("UX_IMPLEMENTATION_TASKS.md")).toBe(true);
    expect(content).toContain("# UX Implementation Tasks");
    expect(content).toContain("### Task");
    expect(content).toContain("Component: Sidebar");
    expect(content).toContain("File: src/components/Sidebar.tsx");
    expect(content).toContain("Component: Forms");
    expect(content).toContain("File: src/components/OrderForm.tsx");
    expect(content).toContain("Component: Workspace");
    expect(content).toContain("File: src/components/WorkspaceShell.tsx");
    expect(content).toContain("User impact:");
    expect(content).toContain("Proposed change:");
    expect(content).toContain("Risk:");
    expect(content).toContain("Effort:");
    expect(content).not.toContain("README");
    expect(navigationContent).toContain("# Navigation Restructure");
    expect(navigationContent).toContain("## Friction Points");
    expect(navigationContent).toContain("Component: Sidebar");
    expect(navigationContent).toContain("Component: Workspace");
    expect(formContent).toContain("# Form Simplification Tasks");
    expect(formContent).toContain("## Form Friction Points");
    expect(formContent).toContain("Component: Forms");
    expect(workspaceContent).toContain("# Workspace Improvements");
    expect(workspaceContent).toContain("Government administrative staff");
    expect(workspaceContent).toContain("Prioritize functional usability over visual design.");
    expect(existsSync(path.join(repoDir, "UX_IMPLEMENTATION_TASKS.md"))).toBe(false);
  });
});
