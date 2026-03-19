import { ArchitectureAgent } from "./architecture_agent";
import { BaseAgent } from "./base-agent";
import { DependencyAgent } from "./dependency_agent";
import { DevAgent } from "./dev_agent";
import { DocumentationAgent } from "./documentation_agent";
import { LegalAgent } from "./legal_agent";
import { ObservabilityAgent } from "./observability_agent";
import { OptimizationAgent } from "./optimization_agent";
import { ProductOwnerAgent } from "./product_owner_agent";
import { QAAgent } from "./qa_agent";
import { SecurityAgent } from "./security_agent";
import { UXAgent } from "./ux_agent";
import { UXImprovementAgent } from "./ux_improvement_agent";

import type { AgentDescriptor } from "../shared/types";

export interface AgentCatalogEntry {
  agent: BaseAgent;
  descriptor: AgentDescriptor;
}

function define(
  agent: BaseAgent,
  descriptor: Omit<AgentDescriptor, "agentId">
): AgentCatalogEntry {
  return {
    agent,
    descriptor: {
      agentId: agent.agentId,
      ...descriptor
    }
  };
}

export function buildAgentCatalog(): AgentCatalogEntry[] {
  return [
    define(new ProductOwnerAgent(), {
      displayName: "ProductOwnerAgent",
      version: "1.0.0",
      capabilities: ["product-analysis", "backlog-prioritization", "proposal-ranking"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "repository-change", "weekly-review"],
      requiresHumanApprovalFor: ["structural changes", "product reprioritization"]
    }),
    define(new QAAgent(), {
      displayName: "QAAgent",
      version: "1.0.0",
      capabilities: ["test-gap-detection", "bug-risk-analysis", "coverage-review"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "repository-change", "security-audit", "incident-detection", "weekly-review"],
      requiresHumanApprovalFor: ["quality gate policy changes"]
    }),
    define(new UXAgent(), {
      displayName: "UXAgent",
      version: "1.0.0",
      capabilities: ["ux-audit", "workflow-friction-analysis", "navigation-clarity-review"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "repository-change", "weekly-review"],
      requiresHumanApprovalFor: ["product workflow changes"]
    }),
    define(new UXImprovementAgent(), {
      displayName: "UXImprovementAgent",
      version: "1.0.0",
      capabilities: ["ux-implementation-planning", "navigation-simplification", "form-simplification"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "repository-change", "weekly-review"],
      requiresHumanApprovalFor: ["product workflow changes", "frontend information architecture changes"]
    }),
    define(new SecurityAgent(), {
      displayName: "SecurityAgent",
      version: "1.0.0",
      capabilities: ["secret-detection", "dependency-hygiene", "container-review"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "security-audit", "security-advisory", "dependency-update", "weekly-review"],
      requiresHumanApprovalFor: ["security-sensitive proposals", "authentication changes"]
    }),
    define(new DependencyAgent(), {
      displayName: "DependencyAgent",
      version: "1.0.0",
      capabilities: ["dependency-governance", "manifest-analysis", "update-risk-review"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "security-audit", "security-advisory", "dependency-update", "weekly-review"],
      requiresHumanApprovalFor: ["dependency policy changes"]
    }),
    define(new ArchitectureAgent(), {
      displayName: "ArchitectureAgent",
      version: "1.0.0",
      capabilities: ["architecture-analysis", "boundary-review", "drift-detection"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "architecture-review", "weekly-review", "incident-detection"],
      requiresHumanApprovalFor: ["architectural decisions", "structural changes"]
    }),
    define(new ObservabilityAgent(), {
      displayName: "ObservabilityAgent",
      version: "1.0.0",
      capabilities: ["observability-analysis", "telemetry-review", "alert-readiness"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "architecture-review", "incident-detection", "weekly-review"],
      requiresHumanApprovalFor: ["alert policy changes"]
    }),
    define(new LegalAgent(), {
      displayName: "LegalAgent",
      version: "1.0.0",
      capabilities: ["license-review", "compliance-gap-analysis", "notice-tracking"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "weekly-review"],
      requiresHumanApprovalFor: ["compliance-sensitive proposals"]
    }),
    define(new OptimizationAgent(), {
      displayName: "OptimizationAgent",
      version: "1.0.0",
      capabilities: ["performance-analysis", "dependency-optimization", "build-efficiency-review"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "architecture-review", "weekly-review", "incident-detection"],
      requiresHumanApprovalFor: ["performance-sensitive infra changes"]
    }),
    define(new DocumentationAgent(), {
      displayName: "DocumentationAgent",
      version: "1.0.0",
      capabilities: ["documentation-generation", "runbook-refresh", "api-doc-sync"],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "architecture-review", "weekly-review", "repository-change"],
      requiresHumanApprovalFor: ["documentation publication policies"]
    }),
    define(new DevAgent(), {
      displayName: "DevAgent",
      version: "1.1.0",
      capabilities: [
        "refactor-analysis",
        "maintainability-review",
        "architecture-risk-detection",
        "static-analysis",
        "engineering-task-proposals"
      ],
      allowedActions: ["analyze", "propose", "report"],
      triggers: ["manual", "repository-change", "security-audit", "architecture-review", "weekly-review"],
      requiresHumanApprovalFor: ["structural changes", "architectural decisions"]
    })
  ];
}
