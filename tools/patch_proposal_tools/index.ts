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

const PATCH_STAGE: WorkflowStage = "PROPOSE_PATCHES";
const TASK_REPORT_FILE = "UX_IMPLEMENTATION_TASKS.md";
const MAX_PATCH_PROPOSALS = 8;

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

function commentPrefix(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    return "//";
  }
  if ([".css", ".scss", ".sass", ".less"].includes(extension)) {
    return "/*";
  }
  return "#";
}

function buildCommentLines(task: UXImplementationTask): string[] {
  const prefix = commentPrefix(task.file);

  if (prefix === "/*") {
    return [
      "/* PATCH PROPOSAL ONLY - do not apply automatically.",
      ` * Component: ${task.component}`,
      ` * Problem: ${task.problem}`,
      ` * Proposed change: ${task.proposedChange}`,
      ` * User impact: ${task.userImpact}`,
      " * Human approval is required before implementation.",
      " */"
    ];
  }

  return [
    `${prefix} PATCH PROPOSAL ONLY - do not apply automatically.`,
    `${prefix} Component: ${task.component}`,
    `${prefix} Problem: ${task.problem}`,
    `${prefix} Proposed change: ${task.proposedChange}`,
    `${prefix} User impact: ${task.userImpact}`,
    `${prefix} Human approval is required before implementation.`
  ];
}

function sampleContextLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
  const context = lines.slice(0, 3);

  return context.length > 0 ? context : [""];
}

function renderPatchProposal(
  task: UXImplementationTask,
  targetContent: string,
  targetExists: boolean,
  sourceTaskPath: string
): string {
  const contextLines = sampleContextLines(targetContent);
  const addedLines = buildCommentLines(task);

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

  if (!targetExists) {
    return `${header}diff --git a/${task.file} b/${task.file}
new file mode 100644
--- /dev/null
+++ b/${task.file}
@@ -0,0 +1,${addedLines.length} @@
${addedLines.map((line) => `+${line}`).join("\n")}
`;
  }

  return `${header}diff --git a/${task.file} b/${task.file}
--- a/${task.file}
+++ b/${task.file}
@@ -1,${contextLines.length} +1,${contextLines.length + addedLines.length} @@
${contextLines.map((line) => ` ${line}`).join("\n")}
${addedLines.map((line) => `+${line}`).join("\n")}
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
  const tasks = sortTasks(parseTaskBlocks(markdown)).slice(0, MAX_PATCH_PROPOSALS);
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
