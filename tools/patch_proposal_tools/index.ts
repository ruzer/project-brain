import path from "node:path";

import { ensureDir, fileExists, readTextSafe, writeFileEnsured } from "../../shared/fs-utils";
import type { PatchProposalArtifact, ProjectContext, WorkflowStage } from "../../shared/types";

type UXTaskRisk = "low" | "medium" | "high";
type UXTaskEffort = "Low" | "Medium" | "High";

interface UXImplementationTask {
  component: string;
  file: string;
  problem: string;
  userImpact: string;
  proposedChange: string;
  risk: UXTaskRisk;
  effort: UXTaskEffort;
}

interface PatchRecipe {
  search: string;
  replace: string;
}

const PATCH_STAGE: WorkflowStage = "PROPOSE_PATCHES";
const TASK_REPORT_FILE = "UX_IMPLEMENTATION_TASKS.md";
const MAX_PATCH_PROPOSALS = 8;
const ALLOWED_UI_TARGET_PATTERNS = [
  /^src\/components\//,
  /^src\/features\//,
  /^src\/layouts\//,
  /^src\/pages\//,
  /^src\/app\//,
  /^src\/shared\/ui\//,
  /^src\/domains\//
] as const;
const BLOCKED_PATCH_PATTERNS = [
  /(^|\/)(api|server|backend)\//i,
  /openapi/i,
  /prisma/i,
  /schema/i,
  /migration/i,
  /database/i,
  /auth/i,
  /financial/i
] as const;

function parseTaskBlocks(markdown: string): UXImplementationTask[] {
  return markdown
    .split(/^### Task\s*$/gm)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const readField = (label: string): string => {
        const match = block.match(new RegExp(`^${label}:\\s*(.+)$`, "im"));
        return match?.[1]?.trim() ?? "";
      };

      return {
        component: readField("Component"),
        file: readField("File"),
        problem: readField("Problem"),
        userImpact: readField("User impact"),
        proposedChange: readField("Proposed change"),
        risk: (readField("Risk").toLowerCase() as UXTaskRisk) || "medium",
        effort: (readField("Effort") as UXTaskEffort) || "Medium"
      };
    })
    .filter((task) => Boolean(task.component && task.file && task.problem && task.proposedChange));
}

function severityWeight(value: UXTaskRisk): number {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  return 1;
}

function effortWeight(value: UXTaskEffort): number {
  if (value === "High") {
    return 3;
  }
  if (value === "Medium") {
    return 2;
  }
  return 1;
}

function sortTasks(tasks: UXImplementationTask[]): UXImplementationTask[] {
  return [...tasks].sort((left, right) => {
    const riskDelta = severityWeight(right.risk) - severityWeight(left.risk);
    if (riskDelta !== 0) {
      return riskDelta;
    }

    return effortWeight(right.effort) - effortWeight(left.effort);
  });
}

function canonicalizeTaskText(value: string): string {
  return value
    .trim()
    .replace(/^\[(high|medium|low)\]\s*/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .toLowerCase();
}

function dedupeTasks(tasks: UXImplementationTask[]): UXImplementationTask[] {
  const seen = new Set<string>();
  const deduped: UXImplementationTask[] = [];

  for (const task of tasks) {
    const key = [
      task.file,
      canonicalizeTaskText(task.problem),
      canonicalizeTaskText(task.proposedChange)
    ].join("::");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(task);
  }

  return deduped;
}

function isAllowedPatchTarget(task: UXImplementationTask): boolean {
  const targetFile = task.file.replace(/^\/+/, "");
  const combinedText = `${targetFile} ${task.problem} ${task.proposedChange}`;

  if (!targetFile.startsWith("src/")) {
    return false;
  }

  if (!ALLOWED_UI_TARGET_PATTERNS.some((pattern) => pattern.test(targetFile))) {
    return false;
  }

  return !BLOCKED_PATCH_PATTERNS.some((pattern) => pattern.test(combinedText));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function patchSlug(task: UXImplementationTask): string {
  const combined = `${task.component} ${task.problem} ${task.proposedChange}`.toLowerCase();

  if (task.component.toLowerCase() === "sidebar") {
    return "sidebar_navigation";
  }
  if (task.component.toLowerCase() === "adminconsolenav") {
    return "admin_console_navigation";
  }
  if (task.component.toLowerCase() === "dashboard") {
    return "dashboard_layout";
  }
  if (task.component.toLowerCase() === "forms") {
    if (/label|terminology|field/i.test(combined)) {
      return "form_labels";
    }
    return "form_simplification";
  }
  if (task.component.toLowerCase() === "workspace") {
    return "workspace_flow";
  }
  if (task.component.toLowerCase() === "tables") {
    return "table_hierarchy";
  }
  if (task.component.toLowerCase() === "search") {
    return "search_refinement";
  }
  if (task.component.toLowerCase() === "dropdowns") {
    return "dropdown_options";
  }

  return slugify(`${task.component}_${task.problem}`) || "ux_patch";
}

function replaceLabels(source: string, labels: Array<[string, string]>): PatchRecipe[] {
  return labels
    .filter(([search]) => source.includes(search))
    .map(([search, replace]) => ({ search, replace }));
}

function resolvePatchRecipes(task: UXImplementationTask, targetContent: string): PatchRecipe[] {
  const targetFile = task.file.replace(/^\/+/, "");

  if (/src\/shared\/ui\/layout\/Sidebar\.tsx$/.test(targetFile)) {
    return [
      ...(targetContent.includes("const NAV_LIFECYCLE_V2_ENABLED = process.env.NEXT_PUBLIC_NAV_LIFECYCLE_V2 !== 'false';")
        ? [
            {
              search: "const NAV_LIFECYCLE_V2_ENABLED = process.env.NEXT_PUBLIC_NAV_LIFECYCLE_V2 !== 'false';",
              replace: `const DAILY_TASK_PATHS = new Set([
  '/dashboard',
  '/expedientes',
  '/sc',
  '/procedimientos',
  '/ordenes',
  '/recepciones',
  '/finanzas/devengos',
]);

const NAV_LIFECYCLE_V2_ENABLED = process.env.NEXT_PUBLIC_NAV_LIFECYCLE_V2 !== 'false';`
            }
          ]
        : []),
      ...(targetContent.includes(
        `      navSections.map((section) => ({
        ...section,
        items: section.items.filter((item) => canAccessPath(item.href, grantedRoles)),
      })).filter((section) => section.items.length > 0),`
      )
        ? [
            {
              search: `      navSections.map((section) => ({
        ...section,
        items: section.items.filter((item) => canAccessPath(item.href, grantedRoles)),
      })).filter((section) => section.items.length > 0),`,
              replace: `      navSections
        .map((section) => ({
          ...section,
          items: section.items
            .filter((item) => canAccessPath(item.href, grantedRoles))
            .sort((left, right) => Number(DAILY_TASK_PATHS.has(right.href)) - Number(DAILY_TASK_PATHS.has(left.href))),
        }))
        .filter((section) => section.items.length > 0),`
            }
          ]
        : [])
    ];
  }

  if (/src\/domains\/admin-console\/components\/AdminConsoleNav\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["label: 'Catálogos'", "label: 'Catálogos básicos'"],
      ["label: 'Configuración'", "label: 'Ajustes del sistema'"],
      ["label: 'Checklists'", "label: 'Listas de revisión'"],
      ["label: 'Observabilidad'", "label: 'Seguimiento técnico'"],
      ["label: 'Importaciones'", "label: 'Carga masiva'"]
    ]);
  }

  if (/src\/domains\/expediente-workspace\/components\/ExpedienteWorkspace\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["<p className={styles.subtitle}>Centro único de trabajo del expediente</p>", "<p className={styles.subtitle}>Revise el estado del expediente y continúe con el siguiente paso sin cambiar de pantalla.</p>"],
      ["<h3 className={styles.blockTitle}>Siguiente paso recomendado</h3>", "<h3 className={styles.blockTitle}>Próximo paso del trámite</h3>"],
      ["<p className={styles.meta}>Acción recomendada: {recommendation.actionLabel}</p>", "<p className={styles.meta}>Acción pendiente: {recommendation.actionLabel}</p>"],
      ["<p className={styles.meta}>Vista sugerida: {recommendation.route}</p>", "<p className={styles.meta}>Abra esta vista para continuar el trámite en el orden correcto: {recommendation.route}</p>"]
    ]);
  }

  if (/src\/domains\/procedimiento-wizard\/components\/ProcedimientoWizard\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["<h2 className={styles.title}>Wizard institucional de procedimiento de compra</h2>", "<h2 className={styles.title}>Pasos del procedimiento de compra</h2>"],
      ["<p className={styles.subtitle}>Expediente: {expedienteId}</p>", "<p className={styles.subtitle}>Complete un paso a la vez y continúe con la acción pendiente del expediente {expedienteId}.</p>"],
      ["<h3 className={styles.quickActionsTitle}>Acciones rápidas</h3>", "<h3 className={styles.quickActionsTitle}>Acciones disponibles en este momento</h3>"],
      [">Generar orden desde cuadro<", ">Generar orden<"],
      [">Abrir recepción<", ">Registrar recepción<"],
      [">Registrar factura<", ">Registrar factura pendiente<"]
    ]);
  }

  if (/src\/domains\/procedimiento-wizard\/components\/NextStepCard\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["<h3 className={styles.title}>Siguiente paso recomendado</h3>", "<h3 className={styles.title}>Próximo paso del trámite</h3>"],
      ["<p className={styles.subtitle}>{nextStep.reason}</p>", "<p className={styles.subtitle}>{nextStep.reason}. Complete este paso para continuar sin perder el orden del procedimiento.</p>"],
      [">Ir al paso<", ">Abrir este paso<"],
      ["<p className={styles.contentHint}>Todos los pasos del wizard están completos.</p>", "<p className={styles.contentHint}>No hay pasos pendientes. Puede revisar el expediente o cerrar el trámite.</p>"]
    ]);
  }

  if (/src\/domains\/necesidades\/components\/NecesidadForm\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["<h3>Crear necesidad (SC)</h3>", "<h3>Registrar solicitud de compra</h3>"],
      [">expedienteId<", ">Expediente<"],
      [">area_id<", ">Área solicitante<"],
      [">descripcion<", ">¿Qué se necesita?<"],
      [">clasificacion_bien<", ">Tipo de bien o servicio<"],
      [">justificacion<", ">Motivo de la compra<"],
      ["{createMutation.isPending ? 'Creando...' : 'Crear necesidad'}", "{createMutation.isPending ? 'Guardando...' : 'Guardar solicitud'}"]
    ]);
  }

  if (/src\/domains\/inventario-write\/components\/InventoryAjustesPanel\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["<h2>Inventario WRITE - Ajustes</h2>", "<h2>Ajustes de inventario</h2>"],
      ["Endpoints contractuales: <code>POST /inventory/ajustes</code> y <code>GET /inventory/ajustes/{'{id}'}</code>.", "Use este panel para registrar y consultar ajustes sin exponer detalles técnicos del servicio."],
      ["<h3>Consultar ajuste por id</h3>", "<h3>Buscar ajuste registrado</h3>"],
      ["placeholder='ajusteId (UUID)'", "placeholder='ID del ajuste'"],
      [">inventarioId<", ">Registro de inventario<"],
      [">productoId<", ">Producto<"],
      [">expedienteId<", ">Expediente relacionado<"],
      [">tipoAjuste<", ">Tipo de ajuste<"],
      [">cantidad<", ">Cantidad ajustada<"],
      [">correlationId (opcional)<", ">Referencia adicional (opcional)<"],
      [">motivo (opcional)<", ">Motivo del ajuste (opcional)<"]
    ]);
  }

  if (/src\/domains\/finanzas\/components\/FinanzasPanel\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["return 'Capture contratoId para iniciar el flujo financiero.';", "return 'Seleccione el contrato para iniciar el seguimiento financiero.';"],
      ["return `Contexto activo: contrato ${contratoId}`;", "return `Contrato seleccionado: ${contratoId}`;"],
      [">contratoId<", ">Contrato<"],
      [">ordenCompraId<", ">Orden de compra<"],
      [">ordenCompraId (heredado)<", ">Orden de compra (heredada)<"],
      [">Cargar flujo<", ">Mostrar seguimiento<"]
    ]);
  }

  if (/src\/domains\/dashboard-institucional\/components\/InstitutionalDashboard\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["Organiza la información en cuatro vistas operativas: seguimiento diario, riesgos, finanzas y control patrimonial.", "Revise primero lo pendiente y después abra la vista operativa que necesita."],
      ["{ key: 'operativo', label: 'Operación' }", "{ key: 'operativo', label: 'Pendientes de hoy' }"],
      ["{ key: 'riesgo', label: 'Riesgos y alertas' }", "{ key: 'riesgo', label: 'Alertas' }"],
      ["{ key: 'financiero', label: 'Seguimiento financiero' }", "{ key: 'financiero', label: 'Finanzas' }"]
    ]);
  }

  if (/src\/domains\/dashboard-operativo\/components\/OperativeDashboard\.tsx$/.test(targetFile)) {
    return replaceLabels(targetContent, [
      ["Vista inicial para seguimiento del ciclo de compra: expedientes activos, riesgos, alertas de proveedores e incidencias operativas.", "Revise aquí los procesos que requieren atención inmediata, los riesgos activos y los pendientes operativos del día."],
      ["title='Procesos con riesgo'", "title='Procesos que requieren atención'"],
      ["title='Incidencias operativas'", "title='Pendientes operativos'"],
      ["title='Procesos recientes'", "title='Procesos por atender'"]
    ]);
  }

  return [];
}

function renderRecipeHunk(recipe: PatchRecipe): string {
  return [
    "@@",
    ...recipe.search.split(/\r?\n/).map((line) => `-${line}`),
    ...recipe.replace.split(/\r?\n/).map((line) => `+${line}`)
  ].join("\n");
}

function renderPatchProposal(
  task: UXImplementationTask,
  targetContent: string,
  targetExists: boolean,
  sourceTaskPath: string
): string {
  const header = [
    `# Stage: ${PATCH_STAGE}`,
    "# Proposal status: review_only",
    "# Human approval required: yes",
    `# Source task file: ${sourceTaskPath}`,
    `# Target file: ${task.file}`,
    `# Component: ${task.component}`,
    `# Risk: ${task.risk}`,
    `# Effort: ${task.effort}`,
    ""
  ].join("\n");

  const recipes = targetExists ? resolvePatchRecipes(task, targetContent) : [];
  const fallbackRecipe =
    recipes.length === 0
      ? [
          {
            search: "",
            replace: `// Review-only proposal for ${task.component}\n// Problem: ${task.problem}\n// Proposed change: ${task.proposedChange}`
          }
        ]
      : recipes;

  const body = fallbackRecipe.map((recipe) => renderRecipeHunk(recipe)).join("\n");

  if (!targetExists) {
    return `${header}diff --git a/${task.file} b/${task.file}
new file mode 100644
--- /dev/null
+++ b/${task.file}
${body}
`;
  }

  return `${header}diff --git a/${task.file} b/${task.file}
--- a/${task.file}
+++ b/${task.file}
${body}
`;
}

export async function generatePatchProposals(
  context: ProjectContext,
  agentId = "dev-agent"
): Promise<PatchProposalArtifact[]> {
  const sourceTaskPath = path.join(context.outputPath, TASK_REPORT_FILE);
  if (!(await fileExists(sourceTaskPath))) {
    return [];
  }

  const markdown = await readTextSafe(sourceTaskPath);
  const tasks = sortTasks(dedupeTasks(parseTaskBlocks(markdown).filter((task) => isAllowedPatchTarget(task)))).slice(
    0,
    MAX_PATCH_PROPOSALS
  );
  if (tasks.length === 0) {
    return [];
  }

  await ensureDir(context.patchProposalDir);

  const proposals: PatchProposalArtifact[] = [];
  const usedSlugs = new Set<string>();

  for (const [index, task] of tasks.entries()) {
    const desiredSlug = patchSlug(task);
    let uniqueSlug = desiredSlug;
    let suffix = 2;
    while (usedSlugs.has(uniqueSlug)) {
      uniqueSlug = `${desiredSlug}_${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(uniqueSlug);

    const patchId = `patch_${String(index + 1).padStart(3, "0")}`;
    const fileName = `${patchId}_${uniqueSlug}.diff`;
    const filePath = path.join(context.patchProposalDir, fileName);
    const targetFile = task.file.replace(/^\/+/, "");
    const targetPath = path.join(context.targetPath, targetFile);
    const targetExists = await fileExists(targetPath);
    const targetContent = targetExists ? await readTextSafe(targetPath) : "";
    const patchContent = renderPatchProposal(task, targetContent, targetExists, TASK_REPORT_FILE);

    await writeFileEnsured(filePath, patchContent);

    proposals.push({
      patchId,
      agentId,
      stage: PATCH_STAGE,
      title: `${task.component} patch proposal`,
      filePath,
      targetFile,
      sourceTaskPath,
      riskLevel: task.risk,
      effort: task.effort,
      requiresHumanApproval: true,
      createdAt: new Date().toISOString()
    });
  }

  return proposals;
}
