import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DevAgent } from "../../agents/dev_agent";
import { UXImprovementAgent } from "../../agents/ux_improvement_agent";
import { ContextBuilder } from "../../core/context_builder";
import { DiscoveryEngine } from "../../core/discovery_engine";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

const originalTimeout = process.env.OLLAMA_TIMEOUT_MS;

describe("ERP frontend UX targeting", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    if (originalTimeout === undefined) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = originalTimeout;
    }

    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("maps UX tasks and review-only patches to real ERP frontend surfaces", async () => {
    const repoDir = await createTempOutputDir("erp-gob-frontend-architecture");
    const outputDir = await createTempOutputDir("project-brain-erp-frontend-ux");
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

    await writeFileEnsured(
      path.join(repoDir, "src", "shared", "ui", "layout", "Sidebar.tsx"),
      `const NAV_LIFECYCLE_V2_ENABLED = process.env.NEXT_PUBLIC_NAV_LIFECYCLE_V2 !== 'false';
export function Sidebar() {
  return null;
}
`
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "domains", "admin-console", "components", "AdminConsoleNav.tsx"),
      `const navItems = [
  { href: '/admin/catalogos', label: 'Catálogos' },
  { href: '/admin/configuracion', label: 'Configuración' },
  { href: '/admin/checklists', label: 'Checklists' },
  { href: '/admin/observabilidad', label: 'Observabilidad' },
  { href: '/admin/importaciones', label: 'Importaciones' },
];
export function AdminConsoleNav() { return null; }
`
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "domains", "procedimiento-wizard", "components", "NextStepCard.tsx"),
      `export function NextStepCard() {
  return (
    <section>
      <h3 className={styles.title}>Siguiente paso recomendado</h3>
      <p className={styles.subtitle}>{nextStep.reason}</p>
      <Button>Ir al paso</Button>
    </section>
  );
}
`
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "domains", "necesidades", "components", "NecesidadForm.tsx"),
      `export function NecesidadForm() {
  return (
    <form>
      <label htmlFor='n-expedienteId'>expedienteId</label>
      <input id='n-expedienteId' />
      <label htmlFor='n-area-id'>area_id</label>
      <input id='n-area-id' />
      <label htmlFor='n-clasificacion'>clasificacion_bien</label>
      <input id='n-clasificacion' />
      <label htmlFor='n-justificacion'>justificacion</label>
      <textarea id='n-justificacion' />
    </form>
  );
}
`
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "domains", "finanzas", "components", "FinanzasPanel.tsx"),
      `export function FinanzasPanel() {
  return (
    <section>
      <label htmlFor='fin-contrato-id'>contratoId</label>
      <input id='fin-contrato-id' />
      <label htmlFor='fin-orden-input'>ordenCompraId</label>
      <input id='fin-orden-input' />
      <Button>Cargar flujo</Button>
    </section>
  );
}
`
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "domains", "dashboard-institucional", "components", "InstitutionalDashboard.tsx"),
      `const VIEWS = [
  { key: 'operativo', label: 'Operación' },
  { key: 'riesgo', label: 'Riesgos y alertas' },
  { key: 'financiero', label: 'Seguimiento financiero' },
  { key: 'patrimonial', label: 'Patrimonio' },
];
export function InstitutionalDashboard() { return null; }
`
    );
    await writeFileEnsured(
      path.join(repoDir, "src", "app", "(private)", "dashboard", "page.tsx"),
      "export default function DashboardPage(){ return null; }\n"
    );

    process.env.OLLAMA_TIMEOUT_MS = "1";

    const discovery = await new DiscoveryEngine().analyze(repoDir);
    const context = await new ContextBuilder().build(discovery, outputDir);

    await writeFileEnsured(
      path.join(context.reportsDir, "ux_report.md"),
      `# UX Report

## Human Deterministic Findings

- Navigation is spread across multiple administrative screens.
- NecesidadForm still shows expedienteId and area_id.
- FinanzasPanel still asks for contratoId and ordenCompraId.
- Workspace views need clearer next-step guidance.

## Combined Recommendations

- Group navigation items by workflow.
- Replace raw technical labels with plain-language labels.
- Explain the next action before users leave the wizard.
`
    );

    await new UXImprovementAgent().run(context);
    const devReport = await new DevAgent().run(context);
    const tasks = await readFile(path.join(outputDir, "UX_IMPLEMENTATION_TASKS.md"), "utf8");
    const patchFiles = (await readdir(context.patchProposalDir)).filter((entry) => entry.endsWith(".diff")).sort();
    const sidebarPatchName = patchFiles.find((entry) => entry.includes("sidebar_navigation"));
    const adminPatchName = patchFiles.find((entry) => entry.includes("admin_console_navigation"));
    const firstPatch = await readFile(path.join(context.patchProposalDir, sidebarPatchName ?? ""), "utf8");
    const secondPatch = await readFile(path.join(context.patchProposalDir, adminPatchName ?? ""), "utf8");
    const reportContent = await readFile(devReport.outputPath, "utf8");

    expect(tasks).toContain("src/shared/ui/layout/Sidebar.tsx");
    expect(tasks).toContain("src/domains/admin-console/components/AdminConsoleNav.tsx");
    expect(tasks).toContain("src/domains/necesidades/components/NecesidadForm.tsx");
    expect(tasks).toContain("src/domains/finanzas/components/FinanzasPanel.tsx");
    expect(sidebarPatchName).toBeTruthy();
    expect(adminPatchName).toBeTruthy();
    expect(firstPatch).toContain("const DAILY_TASK_PATHS = new Set([");
    expect(secondPatch).toContain("label: 'Catálogos básicos'");
    expect(secondPatch).not.toContain("PATCH PROPOSAL ONLY");
    expect(reportContent).toContain("## PROPOSE_PATCHES");
  });
});
