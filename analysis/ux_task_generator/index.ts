import { existsSync } from "node:fs";
import path from "node:path";

import { fileExists, readTextSafe, uniqueSorted, walkDirectory, writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext, RiskLevel } from "../../shared/types";

export type SupportedComponent =
  | "Dashboard"
  | "Sidebar"
  | "AdminConsoleNav"
  | "Forms"
  | "Workspace"
  | "Tables"
  | "Search"
  | "Dropdowns";

interface ComponentRule {
  name: SupportedComponent;
  issueKeywords: RegExp[];
  fileKeywords: RegExp[];
  defaultImpact: string;
  defaultFix: string;
}

interface FrontendCatalog {
  sourceRoot: string;
  scannedDirectories: string[];
  files: string[];
  byComponent: Record<SupportedComponent, string[]>;
}

export interface FrontendUsabilityAnalysis {
  frontendDetected: boolean;
  sourceRoot?: string;
  scannedDirectories: string[];
  pageCount: number;
  layoutCount: number;
  componentFiles: Record<SupportedComponent, string[]>;
  findings: string[];
  recommendations: string[];
  suggestedTasks: UXTask[];
}

export interface UXTask {
  component: SupportedComponent;
  file: string;
  problem: string;
  userImpact: string;
  proposedChange: string;
  risk: RiskLevel;
  effort: "Low" | "Medium" | "High";
}

export interface UXImprovementInputs {
  inputFiles: string[];
  findings: string[];
  recommendations: string[];
  frontendDetected: boolean;
  scannedSourceRoot?: string;
  scannedDirectories: string[];
  componentFiles: Record<SupportedComponent, string[]>;
}

export interface UXImprovementArtifacts {
  implementationTasksPath: string;
  navigationRestructurePath: string;
  formSimplificationTasksPath: string;
  workspaceImprovementsPath: string;
  tasks: UXTask[];
  navigationTasks: UXTask[];
  formTasks: UXTask[];
  inputFiles: string[];
  frontendDetected: boolean;
}

interface ReportInsights {
  findings: string[];
  recommendations: string[];
}

const REPORT_FILES = ["ux_report.md", "usability_findings.md", "workflow_analysis.md"] as const;
const PRIORITY_UI_DIRECTORIES = ["app", "domains", "shared/ui"] as const;
const FALLBACK_UI_DIRECTORIES = ["components", "layouts", "pages", "features"] as const;
const ERP_FRONTEND_PRIORITY_FILES = {
  Sidebar: ["shared/ui/layout/Sidebar.tsx"],
  AdminConsoleNav: ["domains/admin-console/components/AdminConsoleNav.tsx"],
  Workspace: [
    "domains/expediente-workspace/components/ExpedienteWorkspace.tsx",
    "domains/procedimiento-wizard/components/ProcedimientoWizard.tsx",
    "domains/procedimiento-wizard/components/NextStepCard.tsx"
  ],
  Forms: [
    "domains/necesidades/components/NecesidadForm.tsx",
    "domains/inventario-write/components/InventoryAjustesPanel.tsx",
    "domains/finanzas/components/FinanzasPanel.tsx"
  ],
  Dashboard: [
    "domains/dashboard-institucional/components/InstitutionalDashboard.tsx",
    "domains/dashboard-operativo/components/OperativeDashboard.tsx"
  ],
  Tables: [
    "domains/dashboard-operativo/components/ExpedientesRiesgoTable.tsx",
    "domains/dashboard-operativo/components/OperacionesFueraSecuenciaTable.tsx",
    "domains/dashboard-operativo/components/ProveedoresAlertadosTable.tsx"
  ],
  Search: [],
  Dropdowns: [
    "domains/dashboard-institucional/components/InstitutionalDashboard.tsx",
    "domains/inventario-write/components/InventoryAjustesPanel.tsx"
  ]
} satisfies Record<SupportedComponent, string[]>;
const OPERATIONAL_UX_PATTERNS = [
  /navigation/i,
  /sidebar/i,
  /menu/i,
  /dashboard/i,
  /form/i,
  /field/i,
  /input/i,
  /label/i,
  /terminology/i,
  /table/i,
  /search/i,
  /filter/i,
  /workflow/i,
  /workspace/i,
  /step/i,
  /error/i,
  /validation/i,
  /dropdown/i,
  /select/i,
  /combobox/i,
  /searchable/i,
  /plain[- ]language/i,
  /click/i,
  /record/i,
  /task/i,
  /operator/i
] as const;
const NON_OPERATIONAL_UX_PATTERNS = [
  /readme/i,
  /onboarding/i,
  /developer documentation/i,
  /documentation/i,
  /installation/i,
  /install/i,
  /setup/i,
  /contributor/i,
  /api contract/i,
  /openapi/i,
  /prisma/i,
  /server logic/i,
  /backend/i,
  /developer/i
] as const;

const COMPONENT_RULES: ComponentRule[] = [
  {
    name: "Dashboard",
    issueKeywords: [/dashboard/i, /overview/i, /metrics/i, /widget/i, /summary/i],
    fileKeywords: [/dashboard/i, /overview/i, /metrics/i, /widget/i, /home/i],
    defaultImpact: "Users cannot understand system status or priorities quickly.",
    defaultFix: "Simplify dashboard hierarchy, prioritize the primary actions, and remove low-value visual noise."
  },
  {
    name: "Sidebar",
    issueKeywords: [/sidebar/i, /navigation/i, /menu/i, /nav/i, /orientation/i],
    fileKeywords: [/sidebar/i, /nav/i, /menu/i, /layout/i, /shell/i],
    defaultImpact: "Users lose orientation and need extra clicks to reach core workflows.",
    defaultFix: "Reduce navigation depth, group items by task, and make the current location obvious."
  },
  {
    name: "AdminConsoleNav",
    issueKeywords: [/admin/i, /catalog/i, /configuration/i, /observability/i, /administrative navigation/i],
    fileKeywords: [/adminconsolenav/i, /admin-console/i, /catalog/i, /configuracion/i],
    defaultImpact: "Administrative users must interpret technical categories before they can complete a basic task.",
    defaultFix: "Rename technical labels in the admin menu, group related settings, and surface the highest-frequency options first."
  },
  {
    name: "Forms",
    issueKeywords: [/form/i, /field/i, /input/i, /validation/i, /label/i, /terminology/i],
    fileKeywords: [/form/i, /input/i, /field/i, /modal/i, /dialog/i],
    defaultImpact: "Users take longer to complete tasks and are more likely to submit incorrect data.",
    defaultFix: "Split long forms, clarify labels, add helper text, and surface inline validation near the affected field."
  },
  {
    name: "Workspace",
    issueKeywords: [/workflow/i, /workspace/i, /step/i, /journey/i, /handoff/i],
    fileKeywords: [/workspace/i, /shell/i, /layout/i, /page/i, /wizard/i],
    defaultImpact: "Users must jump across screens and lose context while completing a single flow.",
    defaultFix: "Reorganize the workspace around the main step sequence and keep related actions in the same surface."
  },
  {
    name: "Tables",
    issueKeywords: [/table/i, /grid/i, /row/i, /column/i, /list/i],
    fileKeywords: [/table/i, /grid/i, /list/i, /row/i],
    defaultImpact: "Users struggle to scan records, compare values, and act on data quickly.",
    defaultFix: "Improve table hierarchy, prioritize the most relevant columns, and simplify row-level actions."
  },
  {
    name: "Search",
    issueKeywords: [/search/i, /filter/i, /find/i, /lookup/i, /query/i],
    fileKeywords: [/search/i, /filter/i, /lookup/i, /autocomplete/i],
    defaultImpact: "Users spend too much time locating records or filtering large datasets.",
    defaultFix: "Make search and filters more prominent, support faster refinement, and improve empty-state guidance."
  },
  {
    name: "Dropdowns",
    issueKeywords: [/dropdown/i, /select/i, /combobox/i, /picker/i, /option/i],
    fileKeywords: [/dropdown/i, /select/i, /combo/i, /picker/i],
    defaultImpact: "Users struggle to choose the right option and may select incorrect values.",
    defaultFix: "Reduce option overload, group related values, and use searchable selects when the list is long."
  }
];

const FINDING_SECTION_PATTERNS = [
  /human deterministic findings/i,
  /ai insights/i,
  /main usability problems/i,
  /workflow/i,
  /findings/i,
  /pain points/i
];

const RECOMMENDATION_SECTION_PATTERNS = [
  /combined recommendations/i,
  /recommendations/i,
  /task list/i,
  /proposed improvements/i,
  /action items/i
];

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "that",
  "this",
  "from",
  "into",
  "without",
  "have",
  "will",
  "more",
  "less",
  "than",
  "they",
  "them",
  "their",
  "while",
  "where",
  "which",
  "when",
  "what",
  "your",
  "users",
  "user",
  "system",
  "application",
  "frontend",
  "repository"
]);

const IGNORED_FINDINGS = [/ai insights were unavailable for this cycle/i, /^none$/i];
const NAVIGATION_COMPONENTS = new Set<SupportedComponent>(["Sidebar", "AdminConsoleNav", "Workspace"]);
const FORM_COMPONENTS = new Set<SupportedComponent>(["Forms", "Dropdowns"]);

function normalizeMarkdownText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMarkdownSections(content: string): Array<{ title: string; lines: string[] }> {
  const sections: Array<{ title: string; lines: string[] }> = [];
  let currentTitle = "root";
  let currentLines: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const headerMatch = rawLine.match(/^#{1,6}\s+(.+?)\s*$/);
    if (headerMatch) {
      sections.push({ title: currentTitle, lines: currentLines });
      currentTitle = headerMatch[1] ?? "root";
      currentLines = [];
      continue;
    }

    currentLines.push(rawLine);
  }

  sections.push({ title: currentTitle, lines: currentLines });
  return sections.filter((section) => section.lines.length > 0);
}

function extractListItems(lines: string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => normalizeMarkdownText(line))
    .filter(Boolean);
}

function canonicalizeUXText(value: string): string {
  return normalizeMarkdownText(value)
    .replace(/^\[(high|medium|low)\]\s*/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .toLowerCase();
}

function dedupeItems(items: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const item of items) {
    if (IGNORED_FINDINGS.some((pattern) => pattern.test(item))) {
      continue;
    }

    const normalized = canonicalizeUXText(item);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    deduped.push(item);
  }

  return deduped;
}

function extractInsights(content: string): ReportInsights {
  const sections = parseMarkdownSections(content);
  const findings: string[] = [];
  const recommendations: string[] = [];

  for (const section of sections) {
    const items = extractListItems(section.lines);
    if (items.length === 0) {
      continue;
    }

    if (FINDING_SECTION_PATTERNS.some((pattern) => pattern.test(section.title))) {
      findings.push(...items);
      continue;
    }

    if (RECOMMENDATION_SECTION_PATTERNS.some((pattern) => pattern.test(section.title))) {
      recommendations.push(...items);
    }
  }

  if (findings.length === 0 && recommendations.length === 0) {
    const items = extractListItems(content.split(/\r?\n/));
    findings.push(...items);
  }

  return {
    findings: dedupeItems(findings),
    recommendations: dedupeItems(recommendations)
  };
}

function tokenize(value: string): string[] {
  return normalizeMarkdownText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !STOP_WORDS.has(token));
}

function isOperationalUXText(value: string): boolean {
  const normalized = normalizeMarkdownText(value);
  if (!normalized) {
    return false;
  }

  if (NON_OPERATIONAL_UX_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  return OPERATIONAL_UX_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function filterOperationalUXItems(items: string[]): string[] {
  return dedupeItems(items.filter((item) => isOperationalUXText(item)));
}

function scoreRecommendation(issue: string, recommendation: string, component: SupportedComponent): number {
  let score = 0;
  const issueTokens = new Set(tokenize(issue));
  const recommendationTokens = tokenize(recommendation);

  for (const token of recommendationTokens) {
    if (issueTokens.has(token)) {
      score += 2;
    }
  }

  if (recommendation.toLowerCase().includes(component.toLowerCase())) {
    score += 2;
  }

  return score;
}

function selectSourceRoot(targetPath: string): string | undefined {
  const candidates = [path.join(targetPath, "src"), path.join(targetPath, "erp-gob-frontend", "src")];

  return candidates.find((candidate) => existsSync(candidate));
}

async function scanFrontendComponents(targetPath: string): Promise<FrontendCatalog | undefined> {
  const sourceRoot = selectSourceRoot(targetPath);
  if (!sourceRoot) {
    return undefined;
  }

  const preferredDirectories = PRIORITY_UI_DIRECTORIES.map((directory) => path.join(sourceRoot, directory)).filter((directory) =>
    existsSync(directory)
  );
  const fallbackDirectories = FALLBACK_UI_DIRECTORIES.map((directory) => path.join(sourceRoot, directory)).filter((directory) =>
    existsSync(directory)
  );
  const directoriesToScan = [...preferredDirectories, ...fallbackDirectories];
  const scanRoots = directoriesToScan.length > 0 ? directoriesToScan : [sourceRoot];
  const files = uniqueSorted(
    (
      await Promise.all(
        scanRoots.map(async (scanRoot) =>
          (await walkDirectory(scanRoot))
            .filter((file) => /\.(tsx?|jsx?)$/i.test(file))
            .map((file) => path.relative(sourceRoot, path.join(scanRoot, file.replace(/^\.\/+/, ""))))
        )
      )
    )
      .flat()
      .map((file) => file.replace(/\\/g, "/"))
      .filter((file) => !file.startsWith(".."))
  ).sort((left, right) => left.localeCompare(right));

  if (files.length === 0) {
    return undefined;
  }

  const byComponent = Object.fromEntries(
    COMPONENT_RULES.map((rule) => [
      rule.name,
      files.filter((file) => rule.fileKeywords.some((pattern) => pattern.test(file)))
    ])
  ) as Record<SupportedComponent, string[]>;

  return {
    sourceRoot,
    scannedDirectories: scanRoots.map((directory) => path.relative(targetPath, directory) || "."),
    files,
    byComponent
  };
}

function selectComponent(issue: string, catalog: FrontendCatalog): ComponentRule {
  const scoredRules = COMPONENT_RULES.map((rule) => {
    let score = 0;

    for (const keyword of rule.issueKeywords) {
      if (keyword.test(issue)) {
        score += 3;
      }
    }

    if ((catalog.byComponent[rule.name] ?? []).length > 0) {
      score += 1;
    }

    return { rule, score };
  }).sort((left, right) => right.score - left.score);

  return scoredRules[0]?.rule ?? COMPONENT_RULES[0]!;
}

function selectComponentFile(rule: ComponentRule, catalog: FrontendCatalog): string {
  const priorityFiles = ERP_FRONTEND_PRIORITY_FILES[rule.name] as string[];
  const directMatch = preferredFilesForComponent(rule.name, catalog).sort((left, right) => {
    const leftExactPriority = priorityFiles.includes(left) ? 0 : 1;
    const rightExactPriority = priorityFiles.includes(right) ? 0 : 1;
    if (leftExactPriority !== rightExactPriority) {
      return leftExactPriority - rightExactPriority;
    }

    const leftSurfacePriority = /^(app|domains|shared\/ui|components|features|layouts|pages)\//.test(left) ? 0 : 1;
    const rightSurfacePriority = /^(app|domains|shared\/ui|components|features|layouts|pages)\//.test(right) ? 0 : 1;
    if (leftSurfacePriority !== rightSurfacePriority) {
      return leftSurfacePriority - rightSurfacePriority;
    }

    return left.localeCompare(right);
  })[0];
  if (directMatch) {
    return `src/${directMatch}`;
  }

  const shellFallback =
    catalog.files.find((file) => /(app|layout|shell|page)\.(tsx?|jsx?)$/i.test(file)) ??
    catalog.files[0];

  return shellFallback ? `src/${shellFallback}` : "src/";
}

function inferUserImpact(problem: string, rule: ComponentRule): string {
  const normalized = problem.toLowerCase();

  if (/cognitive load|terminology|label|validation|form/.test(normalized)) {
    return COMPONENT_RULES.find((candidate) => candidate.name === "Forms")?.defaultImpact ?? rule.defaultImpact;
  }

  if (/navigation|sidebar|menu|orientation/.test(normalized)) {
    return COMPONENT_RULES.find((candidate) => candidate.name === "Sidebar")?.defaultImpact ?? rule.defaultImpact;
  }

  if (/workflow|workspace|step|journey/.test(normalized)) {
    return COMPONENT_RULES.find((candidate) => candidate.name === "Workspace")?.defaultImpact ?? rule.defaultImpact;
  }

  if (/search|filter|lookup/.test(normalized)) {
    return COMPONENT_RULES.find((candidate) => candidate.name === "Search")?.defaultImpact ?? rule.defaultImpact;
  }

  if (/table|grid|column|row/.test(normalized)) {
    return COMPONENT_RULES.find((candidate) => candidate.name === "Tables")?.defaultImpact ?? rule.defaultImpact;
  }

  return rule.defaultImpact;
}

function inferRisk(problem: string, effort: UXTask["effort"]): RiskLevel {
  if (/\[high\]|critical|blocking|impossible|overly complex/i.test(problem) || effort === "High") {
    return "high";
  }

  if (/\[medium\]|ambigu|confus|cognitive load|workflow/i.test(problem) || effort === "Medium") {
    return "medium";
  }

  return "low";
}

function inferEffort(component: SupportedComponent, file: string, problem: string): UXTask["effort"] {
  let score = 1;

  if (["Dashboard", "Sidebar", "Workspace"].includes(component)) {
    score += 1;
  }

  if (/(layout|shell|page|workspace|wizard)/i.test(file)) {
    score += 1;
  }

  if (/workflow|navigation|cross-screen|multiple|overly complex/i.test(problem)) {
    score += 1;
  }

  if (score >= 4) {
    return "High";
  }

  if (score >= 3) {
    return "Medium";
  }

  return "Low";
}

function selectRecommendation(issue: string, rule: ComponentRule, recommendations: string[]): string {
  const ranked = recommendations
    .map((recommendation) => ({
      recommendation,
      score: scoreRecommendation(issue, recommendation, rule.name)
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.score ? ranked[0].recommendation : rule.defaultFix;
}

function renderTaskReport(task: UXTask): string {
  return [
    "### Task",
    `Component: ${task.component}`,
    `File: ${task.file}`,
    `Problem: ${task.problem}`,
    `User impact: ${task.userImpact}`,
    `Proposed change: ${task.proposedChange}`,
    `Risk: ${task.risk}`,
    `Effort: ${task.effort}`,
    ""
  ].join("\n");
}

function renderTaskReportFile(tasks: UXTask[], inputFiles: string[]): string {
  const fileList = inputFiles.length > 0 ? inputFiles.map((file) => `- ${file}`).join("\n") : "- reports/ux_report.md";
  const body = tasks.map((task) => renderTaskReport(task)).join("\n");

  return `# UX Implementation Tasks

Generated from:
${fileList}

${body}
`;
}

function renderEmptyReport(title: string, inputFiles: string[], message: string): string {
  const fileList = inputFiles.length > 0 ? inputFiles.map((file) => `- ${file}`).join("\n") : "- None";

  return `# ${title}

Generated from:
${fileList}

${message}
`;
}

function renderBulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function filterNavigationTasks(tasks: UXTask[]): UXTask[] {
  return tasks.filter(
    (task) =>
      NAVIGATION_COMPONENTS.has(task.component) ||
      /navigation|sidebar|menu|admin menu|workflow visibility|next action|wizard/i.test(
        `${task.problem} ${task.proposedChange}`
      )
  );
}

function filterFormTasks(tasks: UXTask[]): UXTask[] {
  return tasks.filter(
    (task) =>
      FORM_COMPONENTS.has(task.component) ||
      /form|field|validation|label|dropdown|select|helper text|technical labels|uuid|identifier/i.test(
        `${task.problem} ${task.proposedChange}`
      )
  );
}

function renderNavigationRestructure(tasks: UXTask[], inputFiles: string[]): string {
  if (tasks.length === 0) {
    return renderEmptyReport(
      "Navigation Restructure",
      inputFiles,
      "No navigation simplification tasks were derived from the current UX inputs."
    );
  }

  const frictionPoints = dedupeItems(tasks.map((task) => task.problem));
  const simplifications = dedupeItems(tasks.map((task) => task.proposedChange));

  return `# Navigation Restructure

Generated from:
${inputFiles.map((file) => `- ${file}`).join("\n")}

## Friction Points

${renderBulletList(frictionPoints)}

## Proposed Simplifications

${renderBulletList(simplifications)}

## Tasks

${tasks.map((task) => renderTaskReport(task)).join("\n")}
`;
}

function renderFormSimplificationTasks(tasks: UXTask[], inputFiles: string[]): string {
  if (tasks.length === 0) {
    return renderEmptyReport(
      "Form Simplification Tasks",
      inputFiles,
      "No form simplification tasks were derived from the current UX inputs."
    );
  }

  const painPoints = dedupeItems(tasks.map((task) => task.problem));

  return `# Form Simplification Tasks

Generated from:
${inputFiles.map((file) => `- ${file}`).join("\n")}

## Form Friction Points

${renderBulletList(painPoints)}

## Tasks

${tasks.map((task) => renderTaskReport(task)).join("\n")}
`;
}

function renderWorkspaceImprovements(
  tasks: UXTask[],
  inputFiles: string[],
  analysis: FrontendUsabilityAnalysis
): string {
  if (!analysis.frontendDetected) {
    return renderEmptyReport(
      "Workspace Improvements",
      inputFiles,
      "No frontend UI surface was detected, so no workspace-level usability improvements were generated."
    );
  }

  const priorityTasks = tasks.filter((task) =>
    ["Workspace", "Dashboard", "Sidebar", "Tables", "Search", "Dropdowns"].includes(task.component)
  );
  const frictionPoints = dedupeItems([
    ...analysis.findings,
    ...priorityTasks.map((task) => task.problem)
  ]);
  const actionPlan = dedupeItems([
    ...analysis.recommendations,
    ...priorityTasks.map((task) => task.proposedChange)
  ]);

  return `# Workspace Improvements

Generated from:
${inputFiles.map((file) => `- ${file}`).join("\n")}

## User Persona

- Government administrative staff
- Non-technical
- Repetitive form-based work
- Needs minimal steps and clear language

## Operating Rule

- Prioritize functional usability over visual design.

## UI Surfaces Reviewed

- Scanned directories: ${analysis.scannedDirectories.join(", ") || "none detected"}
- Routed pages: ${analysis.pageCount}
- Layout shells: ${analysis.layoutCount}
- Sidebar files: ${analysis.componentFiles.Sidebar.length}
- Dashboard files: ${analysis.componentFiles.Dashboard.length}
- Workspace files: ${analysis.componentFiles.Workspace.length}
- Form files: ${analysis.componentFiles.Forms.length}
- Table files: ${analysis.componentFiles.Tables.length}
- Search/filter files: ${analysis.componentFiles.Search.length}

## Priority Friction Points

${renderBulletList(frictionPoints)}

## Improvement Directions

${renderBulletList(actionPlan)}

## Component-Level Tasks

${priorityTasks.length > 0 ? priorityTasks.map((task) => renderTaskReport(task)).join("\n") : "No workspace-level tasks were derived from the current UX inputs.\n"}
`;
}

function buildTasks(findings: string[], recommendations: string[], catalog: FrontendCatalog): UXTask[] {
  const dedupedTasks: UXTask[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    const rule = selectComponent(finding, catalog);
    const file = selectComponentFile(rule, catalog);
    const effort = inferEffort(rule.name, file, finding);
    const task: UXTask = {
      component: rule.name,
      file,
      problem: finding,
      userImpact: inferUserImpact(finding, rule),
      proposedChange: selectRecommendation(finding, rule, recommendations),
      risk: inferRisk(finding, effort),
      effort
    };

    const dedupeKey = `${task.component}::${canonicalizeUXText(task.problem)}::${canonicalizeUXText(task.proposedChange)}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    dedupedTasks.push(task);
  }

  return dedupedTasks;
}

function emptyComponentCatalog(): Record<SupportedComponent, string[]> {
  return COMPONENT_RULES.reduce<Record<SupportedComponent, string[]>>((catalog, rule) => {
    catalog[rule.name] = [];
    return catalog;
  }, {} as Record<SupportedComponent, string[]>);
}

export function formatComponentCatalog(inputs: UXImprovementInputs): string {
  const lines = Object.entries(inputs.componentFiles).map(([component, files]) => {
    const sample = files.length > 0 ? files.slice(0, 3).join(", ") : "none detected";
    return `- ${component}: ${sample}`;
  });

  return [
    `Frontend detected: ${inputs.frontendDetected ? "yes" : "no"}`,
    `Source root: ${inputs.scannedSourceRoot ?? "not detected"}`,
    `Scanned directories: ${inputs.scannedDirectories.join(", ") || "none detected"}`,
    "Component file hints:",
    ...lines
  ].join("\n");
}

function countMatches(value: string, pattern: RegExp): number {
  const matches = value.match(pattern);
  return matches?.length ?? 0;
}

interface FrontendFileEntry {
  file: string;
  content: string;
}

function preferredFilesForComponent(component: SupportedComponent, catalog: FrontendCatalog): string[] {
  const preferred = ERP_FRONTEND_PRIORITY_FILES[component].filter((candidate) => catalog.files.includes(candidate));
  const fallback = (catalog.byComponent[component] ?? []).filter((candidate) => !preferred.includes(candidate));
  return [...preferred, ...fallback];
}

function getFileEntry(entries: FrontendFileEntry[], file: string): FrontendFileEntry | undefined {
  return entries.find((entry) => entry.file === file);
}

function createDeterministicTask(
  component: SupportedComponent,
  file: string,
  problem: string,
  userImpact: string,
  proposedChange: string,
  risk: RiskLevel,
  effort: UXTask["effort"]
): UXTask {
  return {
    component,
    file: `src/${file}`,
    problem,
    userImpact,
    proposedChange,
    risk,
    effort
  };
}

function dedupeTasks(tasks: UXTask[]): UXTask[] {
  const seen = new Set<string>();
  const deduped: UXTask[] = [];

  for (const task of tasks) {
    const key = [
      task.component,
      task.file,
      canonicalizeUXText(task.problem),
      canonicalizeUXText(task.proposedChange)
    ].join("::");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(task);
  }

  return deduped;
}

function buildERPFrontendTasks(catalog: FrontendCatalog, contents: FrontendFileEntry[]): UXTask[] {
  const tasks: UXTask[] = [];
  const pageCount = contents.filter(
    (entry) => /(^|\/)app\/.+\/page\.(tsx?|jsx?)$/i.test(entry.file) || /(^|\/)pages\/.+\.(tsx?|jsx?)$/i.test(entry.file)
  ).length;

  const sidebarFile = preferredFilesForComponent("Sidebar", catalog)[0];
  if (sidebarFile) {
    const sidebarEntry = getFileEntry(contents, sidebarFile);
    const navItems = sidebarEntry ? countMatches(sidebarEntry.content, /href:\s*['"]/g) : 0;
    const sections = sidebarEntry ? countMatches(sidebarEntry.content, /title:\s*['"]/g) : 0;
    if (navItems >= 18 || pageCount >= 40) {
      tasks.push(
        createDeterministicTask(
          "Sidebar",
          sidebarFile,
          `The navigation is spread across ${pageCount} routed screens, ${sections} sidebar sections, and ${navItems} menu options, which is too dense for non-technical administrative users.`,
          "Users lose orientation and need extra clicks before they reach the procurement step they use every day.",
          "Group menu entries by procurement workflow, surface the top 5-7 daily actions first, and rename ambiguous labels in plain administrative language.",
          "high",
          "High"
        )
      );
    }
  }

  const adminConsoleNavFile = preferredFilesForComponent("AdminConsoleNav", catalog)[0];
  if (adminConsoleNavFile) {
    const adminEntry = getFileEntry(contents, adminConsoleNavFile);
    const adminItems = adminEntry ? countMatches(adminEntry.content, /href:\s*['"]/g) : 0;
    if (adminItems >= 5) {
      tasks.push(
        createDeterministicTask(
          "AdminConsoleNav",
          adminConsoleNavFile,
          `The administrative navigation exposes ${adminItems} peer options with technical labels such as observability and importaciones, which forces staff to interpret system categories instead of business tasks.`,
          "Administrative users spend more time deciding where to click and are more likely to choose the wrong configuration area.",
          "Rename technical options in user language, move the most frequent actions first, and reserve advanced technical tools for a secondary group.",
          "medium",
          "Low"
        )
      );
    }
  }

  const workspaceFile = preferredFilesForComponent("Workspace", catalog)[0];
  if (workspaceFile) {
    const workspaceEntry = getFileEntry(contents, workspaceFile);
    const linkedPanels = workspaceEntry ? countMatches(workspaceEntry.content, /Panel\b/g) : 0;
    if (linkedPanels >= 5) {
      tasks.push(
        createDeterministicTask(
          "Workspace",
          workspaceFile,
          "The main workspace combines timeline, risks, financial tracking, inventory status, and the procedure wizard in one dense surface, which weakens the visibility of the current step and next action.",
          "Staff have to infer what to do next and may leave the workspace without completing the required procurement step.",
          "Make the current step and next action persistent at the top of the workspace and move secondary monitoring panels below the primary workflow area.",
          "high",
          "High"
        )
      );
    }
  }

  const wizardFile = preferredFilesForComponent("Workspace", catalog).find((file) => /ProcedimientoWizard\.tsx$/i.test(file));
  if (wizardFile) {
    const wizardEntry = getFileEntry(contents, wizardFile);
    const quickActions = wizardEntry ? countMatches(wizardEntry.content, /Acciones rápidas|QuickAction|getWizardQuickActionTarget/g) : 0;
    if (quickActions > 0) {
      tasks.push(
        createDeterministicTask(
          "Workspace",
          wizardFile,
          "The procedure wizard exposes multiple quick actions and stage switches before explaining the current step in plain language.",
          "Users can jump to the wrong procurement stage or miss the legally required order of actions.",
          "Show a short explanation of the current stage, keep one primary next action visible, and demote secondary quick actions behind clearer labels.",
          "medium",
          "Medium"
        )
      );
    }
  }

  const nextStepCardFile = preferredFilesForComponent("Workspace", catalog).find((file) => /NextStepCard\.tsx$/i.test(file));
  if (nextStepCardFile) {
    tasks.push(
      createDeterministicTask(
        "Workspace",
        nextStepCardFile,
        "The next-step card uses generic text like 'Siguiente paso recomendado' and 'Ir al paso', which does not explain the concrete action that the operator must complete.",
        "Users do not understand why the next step matters or what they should complete before leaving the screen.",
        "Rewrite the heading and button copy in action-oriented language and add a one-line explanation of the pending administrative task.",
        "low",
        "Low"
      )
    );
  }

  const necesidadFormFile = preferredFilesForComponent("Forms", catalog).find((file) => /NecesidadForm\.tsx$/i.test(file));
  if (necesidadFormFile) {
    const necesidadEntry = getFileEntry(contents, necesidadFormFile);
    const technicalLabels = necesidadEntry
      ? [
          "expedienteId",
          "area_id",
          "clasificacion_bien",
          "justificacion"
        ].filter((label) => necesidadEntry.content.includes(label))
      : [];
    if (technicalLabels.length >= 3) {
      tasks.push(
        createDeterministicTask(
          "Forms",
          necesidadFormFile,
          `NecesidadForm still shows technical labels (${technicalLabels.join(", ")}) instead of plain-language procurement terms.`,
          "Users have to translate internal field names before they can capture the request correctly.",
          "Replace technical labels with administrative language, keep helper text next to complex fields, and convert area or classification capture to guided selection where possible.",
          "medium",
          "Low"
        )
      );
    }
  }

  const inventoryAjustesFile = preferredFilesForComponent("Forms", catalog).find((file) => /InventoryAjustesPanel\.tsx$/i.test(file));
  if (inventoryAjustesFile) {
    const inventoryEntry = getFileEntry(contents, inventoryAjustesFile);
    const technicalSignals = inventoryEntry
      ? [
          "inventarioId",
          "productoId",
          "expedienteId",
          "correlationId",
          "Endpoints contractuales"
        ].filter((signal) => inventoryEntry.content.includes(signal))
      : [];
    if (technicalSignals.length >= 4) {
      tasks.push(
        createDeterministicTask(
          "Forms",
          inventoryAjustesFile,
          "InventoryAjustesPanel exposes UUID-driven fields and endpoint terminology in the main form, which is too technical for day-to-day inventory adjustments.",
          "Operators need technical identifiers before they can register an adjustment, increasing delays and data-entry mistakes.",
          "Rename technical fields in user language, remove endpoint references from the main panel, and guide users through inventory, product, and expediente selection with clearer prompts.",
          "high",
          "Medium"
        )
      );
    }
  }

  const finanzasPanelFile = preferredFilesForComponent("Forms", catalog).find((file) => /FinanzasPanel\.tsx$/i.test(file));
  if (finanzasPanelFile) {
    const finanzasEntry = getFileEntry(contents, finanzasPanelFile);
    const idPrompts = finanzasEntry
      ? ["contratoId", "ordenCompraId", "Capture contratoId"].filter((token) => finanzasEntry.content.includes(token))
      : [];
    if (idPrompts.length >= 2) {
      tasks.push(
        createDeterministicTask(
          "Forms",
          finanzasPanelFile,
          "FinanzasPanel starts the financial flow by asking for contratoId and ordenCompraId, which assumes technical knowledge instead of business context.",
          "Administrative staff cannot continue unless they already know internal identifiers for the contract and purchase order.",
          "Rename identifiers in plain language, explain the required context, and guide the user to select the contract or order before loading the financial flow.",
          "high",
          "Medium"
        )
      );
    }
  }

  const institutionalDashboardFile = preferredFilesForComponent("Dashboard", catalog).find((file) =>
    /InstitutionalDashboard\.tsx$/i.test(file)
  );
  if (institutionalDashboardFile) {
    const institutionalEntry = getFileEntry(contents, institutionalDashboardFile);
    const viewCount = institutionalEntry ? countMatches(institutionalEntry.content, /key:\s*['"][a-z-]+['"]/g) : 0;
    if (viewCount >= 4) {
      tasks.push(
        createDeterministicTask(
          "Dashboard",
          institutionalDashboardFile,
          `InstitutionalDashboard mixes ${viewCount} dashboard views before showing the most urgent public procurement actions.`,
          "Users must choose between several monitoring perspectives before they understand what is pending today.",
          "Prioritize pending actions and alerts in the first view, simplify tab labels, and use plain-language summaries that explain what requires attention now.",
          "medium",
          "Medium"
        )
      );
    }
  }

  const operativeDashboardFile = preferredFilesForComponent("Dashboard", catalog).find((file) => /OperativeDashboard\.tsx$/i.test(file));
  if (operativeDashboardFile) {
    const operativeEntry = getFileEntry(contents, operativeDashboardFile);
    const tableCount = operativeEntry ? countMatches(operativeEntry.content, /Table\b/g) : 0;
    const searchSignals = operativeEntry ? countMatches(operativeEntry.content, /\bsearch\b|\bfilter\b/i) : 0;
    if (tableCount >= 2 && searchSignals === 0) {
      tasks.push(
        createDeterministicTask(
          "Dashboard",
          operativeDashboardFile,
          "The operative dashboard shows multiple tables and alert lists without an obvious filtering or narrowing mechanism for high-priority records.",
          "Users must scan every row manually to find the expediente or supplier that needs attention.",
          "Introduce clearer prioritization labels and a visible filter/search entry point for the highest-volume dashboard lists.",
          "medium",
          "Medium"
        )
      );
    }
  }

  return dedupeTasks(tasks);
}

function buildGenericOperationalTasks(
  catalog: FrontendCatalog,
  counts: {
    pageCount: number;
    layoutCount: number;
    rawInputSignals: number;
    guidedSelectionSignals: number;
    searchSignals: number;
    filterSignals: number;
    errorSignals: number;
  }
): UXTask[] {
  const tasks: UXTask[] = [];
  const sidebarFile = preferredFilesForComponent("Sidebar", catalog)[0];
  const formFile = preferredFilesForComponent("Forms", catalog)[0];
  const workspaceFile = preferredFilesForComponent("Workspace", catalog)[0];
  const tableFile = preferredFilesForComponent("Tables", catalog)[0];

  if (sidebarFile && (counts.pageCount >= 3 || counts.layoutCount >= 1)) {
    tasks.push(
      createDeterministicTask(
        "Sidebar",
        sidebarFile,
        `Navigation is spread across ${counts.pageCount} routed screens and shared layout shells, which is difficult for non-technical operators to scan quickly.`,
        "Users need extra clicks before they can reach the screen required for their daily task.",
        "Reduce menu depth, group the most common actions together, and keep workflow labels explicit.",
        "medium",
        "Medium"
      )
    );
  }

  if (formFile && counts.rawInputSignals > counts.guidedSelectionSignals) {
    tasks.push(
      createDeterministicTask(
        "Forms",
        formFile,
        "Form workflows appear to rely more on raw text inputs than guided selectors, increasing typing and classification errors.",
        "Users take longer to complete repetitive forms and are more likely to enter inconsistent data.",
        "Replace raw IDs or category inputs with dropdowns, comboboxes, or clearer field labels where valid values are known.",
        "medium",
        "Low"
      )
    );
  }

  if (workspaceFile) {
    tasks.push(
      createDeterministicTask(
        "Workspace",
        workspaceFile,
        "Workspace views need clearer workflow visibility so users can see the current step, next action, and completion state.",
        "Users lose context while moving through a multi-step operational flow.",
        "Keep the current stage and next action visible in the same workspace and demote secondary information.",
        "medium",
        "Medium"
      )
    );
  }

  if (formFile && counts.errorSignals < counts.rawInputSignals) {
    tasks.push(
      createDeterministicTask(
        "Forms",
        formFile,
        "Error guidance appears weaker than the amount of data entry required in the interface.",
        "Users do not know how to fix mistakes when a form fails validation.",
        "Show inline validation and plain-language error messages next to the affected field.",
        "medium",
        "Low"
      )
    );
  }

  if (tableFile && counts.searchSignals + counts.filterSignals === 0) {
    tasks.push(
      createDeterministicTask(
        "Tables",
        tableFile,
        "Record-heavy views do not expose an obvious search or filter entry point.",
        "Users must inspect rows manually to locate the correct record.",
        "Add a visible search/filter control near the main table surface and support lookup by business terms.",
        "medium",
        "Medium"
      )
    );
  }

  return dedupeTasks(tasks);
}

function buildOperationalUsabilityFindings(
  catalog: FrontendCatalog,
  counts: {
    pageCount: number;
    layoutCount: number;
    rawInputSignals: number;
    guidedSelectionSignals: number;
    searchSignals: number;
    filterSignals: number;
    errorSignals: number;
  },
  suggestedTasks: UXTask[]
): FrontendUsabilityAnalysis {
  return {
    frontendDetected: true,
    sourceRoot: catalog.sourceRoot,
    scannedDirectories: catalog.scannedDirectories,
    pageCount: counts.pageCount,
    layoutCount: counts.layoutCount,
    componentFiles: catalog.byComponent,
    findings: filterOperationalUXItems(suggestedTasks.map((task) => task.problem)),
    recommendations: filterOperationalUXItems(suggestedTasks.map((task) => task.proposedChange)),
    suggestedTasks
  };
}

export async function analyzeFrontendUsability(targetPath: string): Promise<FrontendUsabilityAnalysis> {
  const catalog = await scanFrontendComponents(targetPath);

  if (!catalog) {
    return {
      frontendDetected: false,
      scannedDirectories: [],
      pageCount: 0,
      layoutCount: 0,
      componentFiles: emptyComponentCatalog(),
      findings: [],
      recommendations: [],
      suggestedTasks: []
    };
  }

  const contents = await Promise.all(
    catalog.files.map(async (file) => ({
      file,
      content: await readTextSafe(path.join(catalog.sourceRoot, file))
    }))
  );

  const counts = contents.reduce(
    (summary, entry) => {
      if (/(^|\/)app\/.+\/page\.(tsx?|jsx?)$/i.test(entry.file) || /(^|\/)pages\/.+\.(tsx?|jsx?)$/i.test(entry.file)) {
        summary.pageCount += 1;
      }

      if (/(^|\/)layout\.(tsx?|jsx?)$/i.test(entry.file)) {
        summary.layoutCount += 1;
      }

      summary.rawInputSignals += countMatches(entry.content, /<input\b|<textarea\b|\bInput\b/g);
      summary.guidedSelectionSignals += countMatches(entry.content, /<select\b|\bSelect\b|\bCombobox\b|\bAutocomplete\b|\bDropdown\b/g);
      summary.searchSignals += countMatches(entry.content, /\bsearch\b|\bSearch(Input|Bar|Field)?\b/g);
      summary.filterSignals += countMatches(entry.content, /\bfilter\b|\bFilter(s|Panel|Bar)?\b/g);
      summary.errorSignals += countMatches(
        entry.content,
        /\berror\b|\bvalidation\b|\bhelperText\b|\bFormMessage\b|\baria-invalid\b|\bAlert\b/g
      );

      return summary;
    },
    {
      pageCount: 0,
      layoutCount: 0,
      rawInputSignals: 0,
      guidedSelectionSignals: 0,
      searchSignals: 0,
      filterSignals: 0,
      errorSignals: 0
    }
  );

  const erpTasks = buildERPFrontendTasks(catalog, contents);
  const suggestedTasks = erpTasks.length > 0 ? erpTasks : buildGenericOperationalTasks(catalog, counts);
  return buildOperationalUsabilityFindings(catalog, counts, suggestedTasks);
}

export function formatFrontendUsabilityAnalysis(analysis: FrontendUsabilityAnalysis): string {
  const componentLines = Object.entries(analysis.componentFiles).map(([component, files]) => {
    const sample = files.length > 0 ? files.slice(0, 3).join(", ") : "none detected";
    return `- ${component}: ${sample}`;
  });

  return [
    `Frontend detected: ${analysis.frontendDetected ? "yes" : "no"}`,
    `Source root: ${analysis.sourceRoot ?? "not detected"}`,
    `Scanned directories: ${analysis.scannedDirectories.join(", ") || "none detected"}`,
    `Routed pages: ${analysis.pageCount}`,
    `Layouts: ${analysis.layoutCount}`,
    `Deterministic UX tasks: ${analysis.suggestedTasks.length}`,
    "Priority UI surfaces:",
    ...componentLines,
    `Operational findings: ${analysis.findings.join(" | ") || "None"}`,
    `Operational recommendations: ${analysis.recommendations.join(" | ") || "None"}`
  ].join("\n");
}

export async function loadUXImprovementInputs(context: ProjectContext): Promise<UXImprovementInputs> {
  const catalog = await scanFrontendComponents(context.targetPath);
  const existingInputs: string[] = [];
  const findings: string[] = [];
  const recommendations: string[] = [];

  for (const fileName of REPORT_FILES) {
    const reportPath = path.join(context.reportsDir, fileName);
    if (!(await fileExists(reportPath))) {
      continue;
    }

    existingInputs.push(`reports/${fileName}`);
    const content = await readTextSafe(reportPath);
    const extracted = extractInsights(content);
    findings.push(...extracted.findings);
    recommendations.push(...extracted.recommendations);
  }

  return {
    inputFiles: existingInputs,
    findings: filterOperationalUXItems(findings),
    recommendations: filterOperationalUXItems(recommendations),
    frontendDetected: Boolean(catalog),
    scannedSourceRoot: catalog?.sourceRoot,
    scannedDirectories: catalog?.scannedDirectories ?? [],
    componentFiles: catalog?.byComponent ?? emptyComponentCatalog()
  };
}

interface UXImprovementArtifactOptions {
  findings?: string[];
  recommendations?: string[];
  inputFiles?: string[];
  emptyMessage?: string;
}

export async function generateUXImprovementArtifacts(
  context: ProjectContext,
  options: UXImprovementArtifactOptions = {}
): Promise<UXImprovementArtifacts> {
  const inputs = await loadUXImprovementInputs(context);
  const catalog = await scanFrontendComponents(context.targetPath);
  const usabilityAnalysis = await analyzeFrontendUsability(context.targetPath);
  const inputFiles = options.inputFiles ?? inputs.inputFiles;
  const findings = filterOperationalUXItems([
    ...(options.findings ?? inputs.findings),
    ...usabilityAnalysis.findings
  ]);
  const recommendations = filterOperationalUXItems([
    ...(options.recommendations ?? inputs.recommendations),
    ...usabilityAnalysis.recommendations
  ]);

  const implementationTasksPath = path.join(context.outputPath, "UX_IMPLEMENTATION_TASKS.md");
  const navigationRestructurePath = path.join(context.outputPath, "NAVIGATION_RESTRUCTURE.md");
  const formSimplificationTasksPath = path.join(context.outputPath, "FORM_SIMPLIFICATION_TASKS.md");
  const workspaceImprovementsPath = path.join(context.outputPath, "WORKSPACE_IMPROVEMENTS.md");

  if (!catalog) {
    const message = options.emptyMessage ?? "No frontend component surface was detected under src, so no UI implementation tasks were generated.";
    await Promise.all([
      writeFileEnsured(implementationTasksPath, renderEmptyReport("UX Implementation Tasks", inputFiles, message)),
      writeFileEnsured(navigationRestructurePath, renderEmptyReport("Navigation Restructure", inputFiles, message)),
      writeFileEnsured(formSimplificationTasksPath, renderEmptyReport("Form Simplification Tasks", inputFiles, message)),
      writeFileEnsured(workspaceImprovementsPath, renderEmptyReport("Workspace Improvements", inputFiles, message))
    ]);

    return {
      implementationTasksPath,
      navigationRestructurePath,
      formSimplificationTasksPath,
      workspaceImprovementsPath,
      tasks: [],
      navigationTasks: [],
      formTasks: [],
      inputFiles,
      frontendDetected: false
    };
  }

  const taskSeeds = findings.length > 0 ? findings : recommendations;
  const coveredProblems = new Set(usabilityAnalysis.suggestedTasks.map((task) => canonicalizeUXText(task.problem)));
  const inferredTasks = buildTasks(taskSeeds, recommendations, catalog).filter(
    (task) => !coveredProblems.has(canonicalizeUXText(task.problem))
  );
  const tasks = dedupeTasks([...usabilityAnalysis.suggestedTasks, ...inferredTasks]);
  const navigationTasks = filterNavigationTasks(tasks);
  const formTasks = filterFormTasks(tasks);

  if (tasks.length === 0) {
    const message = options.emptyMessage ?? "No actionable UX findings were available to convert into frontend tasks.";
    await Promise.all([
      writeFileEnsured(implementationTasksPath, renderEmptyReport("UX Implementation Tasks", inputFiles, message)),
      writeFileEnsured(navigationRestructurePath, renderEmptyReport("Navigation Restructure", inputFiles, message)),
      writeFileEnsured(formSimplificationTasksPath, renderEmptyReport("Form Simplification Tasks", inputFiles, message)),
      writeFileEnsured(workspaceImprovementsPath, renderWorkspaceImprovements(tasks, inputFiles, usabilityAnalysis))
    ]);
  } else {
    await Promise.all([
      writeFileEnsured(implementationTasksPath, renderTaskReportFile(tasks, inputFiles)),
      writeFileEnsured(navigationRestructurePath, renderNavigationRestructure(navigationTasks, inputFiles)),
      writeFileEnsured(formSimplificationTasksPath, renderFormSimplificationTasks(formTasks, inputFiles)),
      writeFileEnsured(workspaceImprovementsPath, renderWorkspaceImprovements(tasks, inputFiles, usabilityAnalysis))
    ]);
  }

  return {
    implementationTasksPath,
    navigationRestructurePath,
    formSimplificationTasksPath,
    workspaceImprovementsPath,
    tasks,
    navigationTasks,
    formTasks,
    inputFiles,
    frontendDetected: true
  };
}

export async function generateUXImplementationTasks(context: ProjectContext): Promise<string | undefined> {
  const artifacts = await generateUXImprovementArtifacts(context);
  return artifacts.tasks.length > 0 ? artifacts.implementationTasksPath : undefined;
}
