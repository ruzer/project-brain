import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { UXAgent } from "../../agents/ux_agent";
import { ContextBuilder } from "../../core/context_builder";
import { DiscoveryEngine } from "../../core/discovery_engine";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

const originalTimeout = process.env.OLLAMA_TIMEOUT_MS;

describe("UXAgent operational ERP focus", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    if (originalTimeout === undefined) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = originalTimeout;
    }

    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("focuses on UI workflow usability and ignores onboarding or documentation findings", async () => {
    const repoDir = await createTempOutputDir("erp-gob-ux-agent-fixture");
    const outputDir = await createTempOutputDir("project-brain-ux-agent-output");
    cleanupTargets.push(repoDir, outputDir);

    await writeFileEnsured(
      path.join(repoDir, "package.json"),
      JSON.stringify(
        {
          name: "erp-gob-frontend",
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0"
          }
        },
        null,
        2
      )
    );
    await writeFileEnsured(path.join(repoDir, "README.md"), "# Setup\n");
    await writeFileEnsured(path.join(repoDir, "src", "app", "(private)", "dashboard", "page.tsx"), "export default function Page(){ return <div/>; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "app", "(private)", "orders", "page.tsx"), "export default function Orders(){ return <div/>; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "app", "(private)", "cases", "page.tsx"), "export default function Cases(){ return <div/>; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "layouts", "AdminLayout.tsx"), "export function AdminLayout(){ return <div/>; }\n");
    await writeFileEnsured(path.join(repoDir, "src", "components", "Sidebar.tsx"), "export function Sidebar(){ return <nav/>; }\n");
    await writeFileEnsured(
      path.join(repoDir, "src", "features", "providers", "ProveedorForm.tsx"),
      "export function ProveedorForm(){ return <form><input /><input /><select><option>Uno</option></select></form>; }\n"
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "features", "workspace", "ExpedienteWorkspace.tsx"),
      "export function ExpedienteWorkspace(){ return <section>step pending action</section>; }\n"
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "components", "RecordsTable.tsx"),
      "export function RecordsTable(){ return <table><tbody /></table>; }\n"
    );

    process.env.OLLAMA_TIMEOUT_MS = "1";

    const discovery = await new DiscoveryEngine().analyze(repoDir);
    const context = await new ContextBuilder().build(discovery, outputDir);
    const report = await new UXAgent().run(context);
    const content = await readFile(report.outputPath, "utf8");

    expect(content).toContain("## Human Deterministic Findings");
    expect(content).toContain("raw text inputs");
    expect(content).toContain("workflow visibility");
    expect(content).toContain("Error guidance");
    expect(content).not.toContain("README");
    expect(content).not.toContain("onboarding");
    expect(content).not.toContain("installation");
  });
});
