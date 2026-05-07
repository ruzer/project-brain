import path from "node:path";

import type { ProjectContext, ResumeStage } from "../../shared/types";

export type WorkflowId =
  | "memory-brief"
  | "start"
  | "doctor"
  | "map-codebase"
  | "code-graph"
  | "fact-query"
  | "runbook"
  | "harness-audit"
  | "firewall"
  | "swarm"
  | "plan-improvements"
  | "resume"
  | "ask"
  | "review-delta";

export interface WorkflowDefinition {
  workflowId: WorkflowId;
  resumeStage: ResumeStage;
  resumePriority: number;
  humanLabel: string;
  commandLabel: string;
  artifactLabels: string[];
  dependencies: WorkflowId[];
  cheap: boolean;
  usesModel: boolean;
  updatesMemory: boolean;
  rationale: string;
  priority: "high" | "medium" | "low";
}

export interface WorkflowRuntimeDefinition extends WorkflowDefinition {
  artifactPaths: string[];
  command: string;
}

function quoteArg(value: string): string {
  return JSON.stringify(value);
}

function outputFlag(context: ProjectContext): string {
  return `--output ${quoteArg(context.outputPath)}`;
}

function targetArg(context: ProjectContext): string {
  return quoteArg(context.targetPath);
}

export const WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    workflowId: "memory-brief",
    resumeStage: "map-codebase",
    resumePriority: 5,
    humanLabel: "Refresh memory brief",
    commandLabel: "Refresh Memory Brief",
    artifactLabels: ["Memory Brief", "Memory Brief JSON"],
    dependencies: [],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Maintain the compact memory handoff before deeper analysis.",
    priority: "high"
  },
  {
    workflowId: "start",
    resumeStage: "start",
    resumePriority: 11,
    humanLabel: "Guided start",
    commandLabel: "Run Guided Start",
    artifactLabels: ["Start"],
    dependencies: ["memory-brief"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Prepare memory, facts, runbook, harness audit, and firewall before model-heavy work.",
    priority: "high"
  },
  {
    workflowId: "doctor",
    resumeStage: "doctor",
    resumePriority: 1,
    humanLabel: "Check local readiness",
    commandLabel: "Run Doctor",
    artifactLabels: ["Doctor"],
    dependencies: [],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Confirm local tooling and models before spending analysis time.",
    priority: "high"
  },
  {
    workflowId: "map-codebase",
    resumeStage: "map-codebase",
    resumePriority: 2,
    humanLabel: "Refresh codebase map",
    commandLabel: "Generate Codebase Map",
    artifactLabels: ["Codebase Map"],
    dependencies: ["doctor"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Give humans and agents a stable structural overview.",
    priority: "high"
  },
  {
    workflowId: "code-graph",
    resumeStage: "map-codebase",
    resumePriority: 5,
    humanLabel: "Build factual graph",
    commandLabel: "Build Repository Fact Graph",
    artifactLabels: ["Repository Fact Graph", "Repository Fact Graph Report"],
    dependencies: ["map-codebase"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Extract structural evidence before running model workers.",
    priority: "high"
  },
  {
    workflowId: "fact-query",
    resumeStage: "fact-query",
    resumePriority: 6,
    humanLabel: "Query factual memory",
    commandLabel: "Query Factual Memory",
    artifactLabels: ["Fact Query"],
    dependencies: ["code-graph"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Select relevant facts and decisions for the requested work.",
    priority: "medium"
  },
  {
    workflowId: "runbook",
    resumeStage: "runbook",
    resumePriority: 7,
    humanLabel: "Create token-aware runbook",
    commandLabel: "Create Token-Aware Runbook",
    artifactLabels: ["Runbook"],
    dependencies: ["fact-query"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Order deterministic memory, graph, query, governance, and swarm steps before expensive analysis.",
    priority: "medium"
  },
  {
    workflowId: "harness-audit",
    resumeStage: "harness-audit",
    resumePriority: 8,
    humanLabel: "Audit harness readiness",
    commandLabel: "Audit Harness Readiness",
    artifactLabels: ["Harness Audit"],
    dependencies: ["runbook"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Check progressive memory, cost gates, and continuity before model-heavy analysis.",
    priority: "medium"
  },
  {
    workflowId: "firewall",
    resumeStage: "firewall",
    resumePriority: 3,
    humanLabel: "Inspect governance firewall",
    commandLabel: "Inspect Firewall",
    artifactLabels: ["Firewall"],
    dependencies: ["harness-audit"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Confirm agent actions stay review-only and policy-safe.",
    priority: "medium"
  },
  {
    workflowId: "swarm",
    resumeStage: "swarm",
    resumePriority: 9,
    humanLabel: "Run bounded swarm",
    commandLabel: "Run Cheap Swarm",
    artifactLabels: ["Swarm"],
    dependencies: ["firewall", "fact-query"],
    cheap: false,
    usesModel: true,
    updatesMemory: true,
    rationale: "Use model workers only after deterministic memory, graph, and governance context exist.",
    priority: "high"
  },
  {
    workflowId: "plan-improvements",
    resumeStage: "plan-improvements",
    resumePriority: 10,
    humanLabel: "Persist improvement plan",
    commandLabel: "Build Improvement Plan",
    artifactLabels: ["Improvement Plan"],
    dependencies: ["swarm"],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Convert findings into durable direction instead of repeating analysis.",
    priority: "medium"
  },
  {
    workflowId: "resume",
    resumeStage: "bootstrap",
    resumePriority: 0,
    humanLabel: "Resume from current state",
    commandLabel: "Resume Project",
    artifactLabels: ["Resume"],
    dependencies: [],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Show the next useful checkpoint from current artifacts.",
    priority: "low"
  },
  {
    workflowId: "ask",
    resumeStage: "ask",
    resumePriority: 1,
    humanLabel: "Ask brief",
    commandLabel: "Resume Ask",
    artifactLabels: ["Ask Brief"],
    dependencies: [],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Continue from the latest ask brief.",
    priority: "low"
  },
  {
    workflowId: "review-delta",
    resumeStage: "review-delta",
    resumePriority: 4,
    humanLabel: "Review recent changes",
    commandLabel: "Review Recent Changes",
    artifactLabels: ["Impact Radius"],
    dependencies: [],
    cheap: true,
    usesModel: false,
    updatesMemory: true,
    rationale: "Build a bounded review surface for recent git changes.",
    priority: "low"
  }
];

export function workflowCommand(context: ProjectContext, workflowId: WorkflowId, intent = "optimize analysis and cost"): string {
  const output = outputFlag(context);
  switch (workflowId) {
    case "memory-brief":
      return `project-brain status ${targetArg(context)} ${output}`;
    case "start":
      return `project-brain start ${quoteArg(intent)} ${targetArg(context)} ${output}`;
    case "doctor":
      return `project-brain doctor ${targetArg(context)} ${output}`;
    case "map-codebase":
      return `project-brain map-codebase ${targetArg(context)} ${output}`;
    case "code-graph":
      return `project-brain code-graph ${targetArg(context)} ${output}`;
    case "fact-query":
      return `project-brain fact-query ${quoteArg(`${context.repoName} ${intent}`)} ${targetArg(context)} ${output}`;
    case "runbook":
      return `project-brain runbook ${quoteArg(intent)} ${targetArg(context)} ${output}`;
    case "harness-audit":
      return `project-brain harness-audit ${targetArg(context)} ${output}`;
    case "firewall":
      return `project-brain firewall ${targetArg(context)} --trigger repository-change ${output}`;
    case "swarm":
      return `project-brain swarm ${quoteArg(intent)} ${targetArg(context)} ${output} --preset cheap`;
    case "plan-improvements":
      return `project-brain plan-improvements ${targetArg(context)} ${output}`;
    case "resume":
      return `project-brain resume ${targetArg(context)} ${output}`;
    case "ask":
      return `project-brain ask ${quoteArg(intent)} ${targetArg(context)} ${output}`;
    case "review-delta":
      return `project-brain review-delta ${targetArg(context)} ${output}`;
  }
}

export function workflowArtifactPaths(context: ProjectContext, workflowId: WorkflowId): string[] {
  switch (workflowId) {
    case "memory-brief":
      return [
        path.join(context.memoryDir, "MEMORY_BRIEF.md"),
        path.join(context.runtimeMemoryDir, "memory_brief", "memory_brief.json")
      ];
    case "start":
      return [path.join(context.reportsDir, "start.md")];
    case "doctor":
      return [path.join(context.memoryDir, "doctor", "doctor.json")];
    case "map-codebase":
      return [path.join(context.docsDir, "codebase_map", "SUMMARY.md")];
    case "code-graph":
      return [
        path.join(context.runtimeMemoryDir, "knowledge_graph", "repository_fact_graph.json"),
        path.join(context.reportsDir, "repository_fact_graph.md")
      ];
    case "fact-query":
      return [path.join(context.reportsDir, "fact_query.md")];
    case "runbook":
      return [path.join(context.reportsDir, "runbook.md")];
    case "harness-audit":
      return [path.join(context.reportsDir, "harness_audit.md")];
    case "firewall":
      return [path.join(context.reportsDir, "agent_firewall.md")];
    case "swarm":
      return [path.join(context.memoryDir, "swarm", "swarm_run.json")];
    case "plan-improvements":
      return [path.join(context.docsDir, "improvement_plan", "SUMMARY.md")];
    case "resume":
      return [path.join(context.reportsDir, "resume.md")];
    case "ask":
      return [path.join(context.reportsDir, "ask_brief.md")];
    case "review-delta":
      return [path.join(context.reportsDir, "impact_radius.md")];
  }
}

export function buildWorkflowRuntimeDefinitions(context: ProjectContext, intent?: string): WorkflowRuntimeDefinition[] {
  return WORKFLOW_DEFINITIONS.map((definition) => ({
    ...definition,
    artifactPaths: workflowArtifactPaths(context, definition.workflowId),
    command: workflowCommand(context, definition.workflowId, intent)
  }));
}

export function getWorkflowDefinition(workflowId: WorkflowId): WorkflowDefinition {
  const definition = WORKFLOW_DEFINITIONS.find((item) => item.workflowId === workflowId);
  if (!definition) {
    throw new Error(`Unknown workflow: ${workflowId}`);
  }
  return definition;
}

export function workflowForArtifactLabel(label: string): WorkflowDefinition | undefined {
  return WORKFLOW_DEFINITIONS.find((definition) => definition.artifactLabels.includes(label));
}
