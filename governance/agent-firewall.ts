import path from "node:path";

import { ensureDir, relativeTo, writeFileEnsured, writeJsonEnsured } from "../shared/fs-utils";
import type {
  AgentDescriptor,
  AgentTask,
  AgentTaskPacket,
  FirewallDecision,
  FirewallPolicyPack,
  FirewallSummary,
  FirewallToolRule,
  GovernanceTrigger,
  ProjectContext,
  RiskLevel
} from "../shared/types";

const SENSITIVE_PATTERNS = [
  /security/i,
  /auth/i,
  /secret/i,
  /infra/i,
  /deploy/i,
  /compliance/i,
  /architecture/i,
  /structural/i,
  /dependency/i,
  /incident/i
];

const WRITE_INTENT_PATTERNS = [
  /refactor/i,
  /implementation/i,
  /rewrite/i,
  /migration/i,
  /maintainability/i,
  /frontend information architecture/i,
  /structural changes/i
];

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function detectScopePaths(agentId: string, context: ProjectContext): string[] {
  const manifests = context.discovery.manifests.slice(0, 2);
  const infraFiles = context.discovery.infraFiles.slice(0, 2);
  const apiFiles = context.discovery.apiFiles.slice(0, 2);
  const topLevel = context.discovery.structure.topLevelDirectories.slice(0, 4);

  if (agentId === "qa-agent") {
    return ["tests/", ...manifests];
  }

  if (agentId === "security-agent" || agentId === "dependency-agent") {
    return [...manifests, ...infraFiles];
  }

  if (agentId === "documentation-agent" || agentId === "product-owner-agent") {
    return ["docs/", "README.md", ...apiFiles];
  }

  if (agentId === "observability-agent") {
    return [...infraFiles, "integrations/", "reports/"];
  }

  if (agentId === "ux-agent" || agentId === "ux-improvement-agent") {
    return ["src/", "docs/", "README.md"];
  }

  return topLevel.length > 0 ? topLevel : ["src/", "docs/"];
}

function detectContextPaths(context: ProjectContext): string[] {
  return [
    path.join(context.memoryDir, "PROJECT_MODEL.md"),
    path.join(context.memoryDir, "ARCHITECTURE.md"),
    path.join(context.memoryDir, "STACK_PROFILE.md"),
    path.join(context.memoryDir, "ANNOTATIONS.md"),
    path.join(context.memoryDir, "RULES.md")
  ];
}

function expectedOutputsFor(descriptor: AgentDescriptor): string[] {
  return [
    `${descriptor.displayName} markdown report with findings and recommendations.`,
    "Proposal artifacts only if the agent emits actionable recommendations.",
    "No direct target-repository mutation."
  ];
}

function classifyRisk(
  descriptor: AgentDescriptor,
  task: AgentTask,
  context: ProjectContext
): { score: number; riskLevel: RiskLevel; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const descriptorText = `${descriptor.capabilities.join(" ")} ${descriptor.requiresHumanApprovalFor.join(" ")}`;
  const taskText = `${task.title} ${task.description} ${task.rationale}`;

  const triggerWeights: Record<GovernanceTrigger, number> = {
    manual: 1,
    "repository-change": 2,
    "weekly-review": 1,
    "security-audit": 4,
    "security-advisory": 4,
    "architecture-review": 3,
    "incident-detection": 4,
    "dependency-update": 3
  };

  score += triggerWeights[task.trigger];
  reasons.push(`trigger=${task.trigger}`);

  if (matchesAny(descriptorText, SENSITIVE_PATTERNS) || matchesAny(taskText, SENSITIVE_PATTERNS)) {
    score += 2;
    reasons.push("sensitive-domain");
  }

  if (matchesAny(descriptorText, WRITE_INTENT_PATTERNS)) {
    score += 1;
    reasons.push("change-heavy-domain");
  }

  if (context.discovery.infrastructure.length > 0 || context.discovery.infraFiles.length > 0) {
    score += 1;
    reasons.push("infrastructure-present");
  }

  if (context.discovery.git.isGitRepo) {
    score += 1;
    reasons.push("git-governed");
  }

  const riskLevel: RiskLevel = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
  return { score, riskLevel, reasons };
}

function selectPolicyPack(
  descriptor: AgentDescriptor,
  task: AgentTask,
  riskLevel: RiskLevel
): { policyPack: FirewallPolicyPack; rationale: string } {
  const descriptorText = `${descriptor.capabilities.join(" ")} ${descriptor.requiresHumanApprovalFor.join(" ")}`.toLowerCase();

  if (descriptorText.includes("deploy") || task.title.toLowerCase().includes("deploy")) {
    return {
      policyPack: "deploy",
      rationale: "Task touches deploy-adjacent responsibilities and must stay behind explicit approvals."
    };
  }

  if (riskLevel === "high" || task.trigger === "incident-detection" || task.trigger === "security-audit") {
    return {
      policyPack: "review",
      rationale: "High-risk or incident/security-triggered tasks stay in review mode."
    };
  }

  if (matchesAny(descriptorText, WRITE_INTENT_PATTERNS)) {
    return {
      policyPack: "edit-limited",
      rationale: "Task influences implementation strategy, so future writes must remain tightly scoped."
    };
  }

  if (matchesAny(descriptorText, SENSITIVE_PATTERNS)) {
    return {
      policyPack: "review",
      rationale: "Sensitive domains require extra controls even in analysis mode."
    };
  }

  return {
    policyPack: "safe-readonly",
    rationale: "Task is analysis-first and can remain in a readonly operating posture."
  };
}

function buildToolRules(policyPack: FirewallPolicyPack): FirewallToolRule[] {
  const shared: FirewallToolRule[] = [
    {
      tool: "read-repository",
      mode: "allow",
      rationale: "Repository inspection is required for every governed task."
    },
    {
      tool: "read-generated-context",
      mode: "allow",
      rationale: "Agents may consume generated project context and prior artifacts."
    },
    {
      tool: "write-generated-artifacts",
      mode: "allow",
      rationale: "Agents may write reports and proposals into output artifacts."
    },
    {
      tool: "read-git",
      mode: "allow",
      rationale: "Git metadata is safe to inspect for review and impact analysis."
    }
  ];

  if (policyPack === "safe-readonly") {
    return [
      ...shared,
      { tool: "run-tests", mode: "deny", rationale: "Readonly tasks should not expand into active execution." },
      { tool: "run-build", mode: "deny", rationale: "Readonly tasks avoid build-side effects." },
      { tool: "write-target-files", mode: "deny", rationale: "Target files remain immutable in readonly mode." },
      { tool: "delete-target-files", mode: "deny", rationale: "Destructive file operations are blocked." },
      { tool: "write-git", mode: "deny", rationale: "Git writes are blocked by default." },
      { tool: "network-egress", mode: "deny", rationale: "Network access is denied unless explicitly approved." },
      { tool: "deploy", mode: "deny", rationale: "Deployment is outside readonly scope." }
    ];
  }

  if (policyPack === "review") {
    return [
      ...shared,
      { tool: "run-tests", mode: "allow", rationale: "Review-mode tasks may validate assumptions with tests." },
      { tool: "run-build", mode: "approval-required", rationale: "Build execution is allowed only with explicit approval." },
      { tool: "write-target-files", mode: "deny", rationale: "Review mode remains non-destructive." },
      { tool: "delete-target-files", mode: "deny", rationale: "Destructive file operations remain blocked." },
      { tool: "write-git", mode: "deny", rationale: "Git writes are not allowed in review mode." },
      { tool: "network-egress", mode: "approval-required", rationale: "External access requires explicit approval." },
      { tool: "deploy", mode: "deny", rationale: "Deployment remains blocked." }
    ];
  }

  if (policyPack === "edit-limited") {
    return [
      ...shared,
      { tool: "run-tests", mode: "allow", rationale: "Scoped edits should be validated with tests." },
      { tool: "run-build", mode: "allow", rationale: "Scoped edits may require local build validation." },
      { tool: "write-target-files", mode: "approval-required", rationale: "Target writes require a human decision and explicit scope." },
      { tool: "delete-target-files", mode: "deny", rationale: "Deletion stays blocked even in edit-limited mode." },
      { tool: "write-git", mode: "deny", rationale: "Git writes remain blocked until a higher trust mode exists." },
      { tool: "network-egress", mode: "approval-required", rationale: "External access remains gated." },
      { tool: "deploy", mode: "deny", rationale: "Deployment is outside edit-limited scope." }
    ];
  }

  return [
    ...shared,
    { tool: "run-tests", mode: "allow", rationale: "Deploy-class tasks need validation." },
    { tool: "run-build", mode: "allow", rationale: "Deploy-class tasks need build verification." },
    { tool: "write-target-files", mode: "approval-required", rationale: "Production-adjacent changes require approval." },
    { tool: "delete-target-files", mode: "approval-required", rationale: "Destructive actions require explicit approval." },
    { tool: "write-git", mode: "approval-required", rationale: "Git writes require review." },
    { tool: "network-egress", mode: "approval-required", rationale: "Network access requires review." },
    { tool: "deploy", mode: "approval-required", rationale: "Deployment always requires explicit approval." }
  ];
}

function buildConstraints(
  descriptor: AgentDescriptor,
  task: AgentTask,
  policyPack: FirewallPolicyPack
): string[] {
  const constraints = [
    "Do not modify the target repository automatically.",
    "Constrain work to the approved scope paths and generated artifacts.",
    "Escalate ambiguity instead of assuming permission."
  ];

  if (policyPack === "safe-readonly") {
    constraints.push("Stay readonly: analyze, summarize, and propose only.");
  }

  if (policyPack === "review") {
    constraints.push("Treat findings as review material; no target writes are permitted.");
  }

  if (policyPack === "edit-limited") {
    constraints.push("If the task is ever promoted to edit mode, writes must stay within the scoped files only.");
  }

  for (const item of descriptor.requiresHumanApprovalFor) {
    constraints.push(`Human approval required for ${item}.`);
  }

  constraints.push(`Current trigger: ${task.trigger}.`);
  return constraints;
}

function decide(
  descriptor: AgentDescriptor,
  policyPack: FirewallPolicyPack,
  riskLevel: RiskLevel
): { decision: FirewallDecision; requiresHumanApproval: boolean; requiredApprovals: string[]; rationale: string } {
  const requiredApprovals = [...descriptor.requiresHumanApprovalFor];
  const unsafeAction = descriptor.allowedActions.find((action) => !["analyze", "propose", "report"].includes(action));

  if (unsafeAction) {
    return {
      decision: "BLOCKED",
      requiresHumanApproval: true,
      requiredApprovals,
      rationale: `Blocked because descriptor declared unsupported action ${unsafeAction}.`
    };
  }

  if (policyPack === "deploy") {
    return {
      decision: "ALLOW_WITH_REVIEW",
      requiresHumanApproval: true,
      requiredApprovals: [...requiredApprovals, "deploy approval"],
      rationale: "Deploy-class tasks may proceed only behind explicit human review."
    };
  }

  if (policyPack === "edit-limited" || riskLevel === "high" || requiredApprovals.length > 0) {
    return {
      decision: "ALLOW_WITH_REVIEW",
      requiresHumanApproval: true,
      requiredApprovals,
      rationale: "Task may run in analysis mode, but any promotion beyond readonly work requires review."
    };
  }

  return {
    decision: "ALLOW",
    requiresHumanApproval: false,
    requiredApprovals,
    rationale: "Task fits the current non-destructive operating mode."
  };
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderToolRules(toolRules: FirewallToolRule[]): string {
  return toolRules
    .map((rule) => `- ${rule.tool}: ${rule.mode} (${rule.rationale})`)
    .join("\n");
}

interface PlannedAgentTask {
  task: AgentTask;
  descriptor: AgentDescriptor;
}

export class AgentFirewall {
  async assessPlan(
    context: ProjectContext,
    trigger: GovernanceTrigger,
    plannedTasks: PlannedAgentTask[]
  ): Promise<FirewallSummary> {
    const packetDir = path.join(context.taskBoardDir, "packets");
    const policyDir = path.join(context.runtimeMemoryDir, "firewall");
    const reportPath = path.join(context.reportsDir, "agent_firewall.md");
    const policyPath = path.join(policyDir, "agent_firewall.json");

    await ensureDir(packetDir);
    await ensureDir(policyDir);

    const packets: AgentTaskPacket[] = [];

    for (const planned of plannedTasks) {
      const { score, riskLevel, reasons } = classifyRisk(planned.descriptor, planned.task, context);
      const { policyPack, rationale: policyRationale } = selectPolicyPack(planned.descriptor, planned.task, riskLevel);
      const toolRules = buildToolRules(policyPack);
      const decision = decide(planned.descriptor, policyPack, riskLevel);
      const packetPath = path.join(packetDir, `${planned.task.taskId}.md`);
      const scopePaths = detectScopePaths(planned.task.agentId, context);
      const contextPaths = detectContextPaths(context).map((filePath) => relativeTo(context.outputPath, filePath));
      const packet: AgentTaskPacket = {
        taskId: planned.task.taskId,
        agentId: planned.task.agentId,
        trigger,
        goal: planned.task.description,
        scopePaths,
        contextPaths,
        constraints: buildConstraints(planned.descriptor, planned.task, policyPack),
        expectedOutput: expectedOutputsFor(planned.descriptor),
        policyPack,
        riskLevel,
        decision: decision.decision,
        decisionRationale: `${decision.rationale} Policy=${policyPack}. Risk score=${score} (${reasons.join(", ")}). ${policyRationale}`,
        requiresHumanApproval: decision.requiresHumanApproval,
        requiredApprovals: decision.requiredApprovals,
        toolRules,
        packetPath
      };

      await writeFileEnsured(
        packetPath,
        `# Task Packet: ${planned.task.taskId}

## Agent

- Agent: ${planned.descriptor.displayName}
- Trigger: ${trigger}
- Goal: ${packet.goal}

## Firewall decision

- Decision: ${packet.decision}
- Policy pack: ${packet.policyPack}
- Risk level: ${packet.riskLevel}
- Requires human approval: ${packet.requiresHumanApproval ? "yes" : "no"}
- Rationale: ${packet.decisionRationale}

## Scope paths

${renderList(packet.scopePaths)}

## Context paths

${renderList(packet.contextPaths)}

## Constraints

${renderList(packet.constraints)}

## Expected output

${renderList(packet.expectedOutput)}

## Tool rules

${renderToolRules(packet.toolRules)}

## Required approvals

${renderList(packet.requiredApprovals)}
`
      );

      packets.push(packet);
    }

    const stats: FirewallSummary["stats"] = {
      allowed: packets.filter((packet) => packet.decision === "ALLOW").length,
      reviewRequired: packets.filter((packet) => packet.decision === "ALLOW_WITH_REVIEW").length,
      blocked: packets.filter((packet) => packet.decision === "BLOCKED").length,
      lowRisk: packets.filter((packet) => packet.riskLevel === "low").length,
      mediumRisk: packets.filter((packet) => packet.riskLevel === "medium").length,
      highRisk: packets.filter((packet) => packet.riskLevel === "high").length,
      byPolicyPack: {
        "safe-readonly": packets.filter((packet) => packet.policyPack === "safe-readonly").length,
        review: packets.filter((packet) => packet.policyPack === "review").length,
        "edit-limited": packets.filter((packet) => packet.policyPack === "edit-limited").length,
        deploy: packets.filter((packet) => packet.policyPack === "deploy").length
      }
    };

    const summary: FirewallSummary = {
      generatedAt: new Date().toISOString(),
      trigger,
      reportPath,
      policyPath,
      packetDir,
      packets,
      stats
    };

    await writeJsonEnsured(policyPath, summary);
    await writeFileEnsured(
      reportPath,
      `# Agent Firewall Report

## Overview

- Repository: ${context.repoName}
- Trigger: ${trigger}
- Packets: ${packets.length}
- Allowed: ${stats.allowed}
- Review required: ${stats.reviewRequired}
- Blocked: ${stats.blocked}
- Risk distribution: low=${stats.lowRisk}, medium=${stats.mediumRisk}, high=${stats.highRisk}

## Policy packs

- safe-readonly: ${stats.byPolicyPack["safe-readonly"]}
- review: ${stats.byPolicyPack.review}
- edit-limited: ${stats.byPolicyPack["edit-limited"]}
- deploy: ${stats.byPolicyPack.deploy}

## Task decisions

${renderList(
  packets.map(
    (packet) =>
      `${packet.taskId} | ${packet.agentId} | ${packet.decision} | policy=${packet.policyPack} | risk=${packet.riskLevel} | approvals=${packet.requiredApprovals.join(", ") || "None"}`
  )
)}

## Blocked operations

${renderList(
  [...new Set(
    packets.flatMap((packet) =>
      packet.toolRules.filter((rule) => rule.mode === "deny").map((rule) => `${packet.agentId}: ${rule.tool}`)
    )
  )]
)}
`
    );

    return summary;
  }
}
