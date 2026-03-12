import { existsSync } from "node:fs";
import path from "node:path";

import { fileExists, readTextSafe, walkDirectory, writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext, RiskLevel } from "../../shared/types";

export type SupportedComponent =
  | "Dashboard"
  | "Sidebar"
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
  files: string[];
  byComponent: Record<SupportedComponent, string[]>;
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
  componentFiles: Record<SupportedComponent, string[]>;
}

export interface UXImprovementArtifacts {
  implementationTasksPath: string;
  navigationRestructurePath: string;
  formSimplificationTasksPath: string;
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
const NAVIGATION_COMPONENTS = new Set<SupportedComponent>(["Dashboard", "Sidebar", "Workspace", "Search"]);
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

function dedupeItems(items: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const item of items) {
    if (IGNORED_FINDINGS.some((pattern) => pattern.test(item))) {
      continue;
    }

    const normalized = item.toLowerCase();
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

  const files = (await walkDirectory(sourceRoot))
    .filter((file) => /\.(tsx?|jsx?)$/i.test(file))
    .map((file) => file.replace(/^\.\/+/, ""))
    .sort((left, right) => left.localeCompare(right));

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
  const directMatch = catalog.byComponent[rule.name]?.[0];
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
      /navigation|sidebar|menu|workflow|workspace|search|filter/i.test(`${task.problem} ${task.proposedChange}`)
  );
}

function filterFormTasks(tasks: UXTask[]): UXTask[] {
  return tasks.filter(
    (task) =>
      FORM_COMPONENTS.has(task.component) ||
      /form|field|validation|label|dropdown|select|helper text/i.test(`${task.problem} ${task.proposedChange}`)
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

    const dedupeKey = `${task.component}::${task.problem.toLowerCase()}`;
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
    "Component file hints:",
    ...lines
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
    findings: dedupeItems(findings),
    recommendations: dedupeItems(recommendations),
    frontendDetected: Boolean(catalog),
    scannedSourceRoot: catalog?.sourceRoot,
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
  const inputFiles = options.inputFiles ?? inputs.inputFiles;
  const findings = dedupeItems(options.findings ?? inputs.findings);
  const recommendations = dedupeItems(options.recommendations ?? inputs.recommendations);

  const implementationTasksPath = path.join(context.outputPath, "UX_IMPLEMENTATION_TASKS.md");
  const navigationRestructurePath = path.join(context.outputPath, "NAVIGATION_RESTRUCTURE.md");
  const formSimplificationTasksPath = path.join(context.outputPath, "FORM_SIMPLIFICATION_TASKS.md");

  if (!catalog) {
    const message = options.emptyMessage ?? "No frontend component surface was detected under src, so no UI implementation tasks were generated.";
    await Promise.all([
      writeFileEnsured(implementationTasksPath, renderEmptyReport("UX Implementation Tasks", inputFiles, message)),
      writeFileEnsured(navigationRestructurePath, renderEmptyReport("Navigation Restructure", inputFiles, message)),
      writeFileEnsured(formSimplificationTasksPath, renderEmptyReport("Form Simplification Tasks", inputFiles, message))
    ]);

    return {
      implementationTasksPath,
      navigationRestructurePath,
      formSimplificationTasksPath,
      tasks: [],
      navigationTasks: [],
      formTasks: [],
      inputFiles,
      frontendDetected: false
    };
  }

  const taskSeeds = findings.length > 0 ? findings : recommendations;
  const tasks = buildTasks(taskSeeds, recommendations, catalog);
  const navigationTasks = filterNavigationTasks(tasks);
  const formTasks = filterFormTasks(tasks);

  if (tasks.length === 0) {
    const message = options.emptyMessage ?? "No actionable UX findings were available to convert into frontend tasks.";
    await Promise.all([
      writeFileEnsured(implementationTasksPath, renderEmptyReport("UX Implementation Tasks", inputFiles, message)),
      writeFileEnsured(navigationRestructurePath, renderEmptyReport("Navigation Restructure", inputFiles, message)),
      writeFileEnsured(formSimplificationTasksPath, renderEmptyReport("Form Simplification Tasks", inputFiles, message))
    ]);
  } else {
    await Promise.all([
      writeFileEnsured(implementationTasksPath, renderTaskReportFile(tasks, inputFiles)),
      writeFileEnsured(navigationRestructurePath, renderNavigationRestructure(navigationTasks, inputFiles)),
      writeFileEnsured(formSimplificationTasksPath, renderFormSimplificationTasks(formTasks, inputFiles))
    ]);
  }

  return {
    implementationTasksPath,
    navigationRestructurePath,
    formSimplificationTasksPath,
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
