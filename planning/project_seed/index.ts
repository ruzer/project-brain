import path from "node:path";

import { ensureDir, fileExists, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectSeedArchetype, ProjectSeedInput, ProjectSeedPriority, ProjectSeedResult } from "../../shared/types";

interface ArchetypeDefinition {
  label: string;
  defaultStack: string;
  defaultFeatures: string[];
  defaultEntities: string[];
  defaultIntegrations: string[];
  buildOrder: string[];
}

const ARCHETYPES: Record<ProjectSeedArchetype, ArchetypeDefinition> = {
  "saas-webapp": {
    label: "SaaS / Web App",
    defaultStack: "Next.js + PostgreSQL + Prisma + email + object storage",
    defaultFeatures: ["workspace onboarding", "dashboard", "billing-ready account model", "admin settings"],
    defaultEntities: ["User", "Workspace", "Membership", "Project", "ActivityLog"],
    defaultIntegrations: ["email", "object storage", "analytics"],
    buildOrder: ["domain model", "auth and roles", "core CRUD flows", "dashboard", "billing boundary", "deployment"]
  },
  "marketing-site": {
    label: "Marketing Site",
    defaultStack: "Astro or Next.js static site + CMS-ready content model",
    defaultFeatures: ["landing page", "content sections", "lead capture", "SEO metadata"],
    defaultEntities: ["Page", "Lead", "Campaign", "Article"],
    defaultIntegrations: ["analytics", "email capture", "CMS"],
    buildOrder: ["content model", "visual system", "landing page", "SEO", "forms", "deployment"]
  },
  "mobile-app": {
    label: "Mobile App",
    defaultStack: "Expo React Native + API backend + local persistence",
    defaultFeatures: ["onboarding", "authenticated app shell", "offline-ready screens", "push-ready settings"],
    defaultEntities: ["User", "Device", "Session", "Notification"],
    defaultIntegrations: ["push notifications", "analytics", "auth provider"],
    buildOrder: ["navigation", "auth", "core screens", "offline state", "notifications", "store/deployment"]
  },
  "api-backend": {
    label: "API / Backend",
    defaultStack: "Node.js API + PostgreSQL + OpenAPI + Docker",
    defaultFeatures: ["REST API", "input validation", "database migrations", "health checks"],
    defaultEntities: ["User", "ApiKey", "AuditEvent", "Resource"],
    defaultIntegrations: ["database", "observability", "CI"],
    buildOrder: ["data model", "API contracts", "validation", "auth", "observability", "deployment"]
  },
  "internal-tool": {
    label: "Internal Tool",
    defaultStack: "Next.js admin dashboard + PostgreSQL + role-based access",
    defaultFeatures: ["operator dashboard", "tables and filters", "role-gated actions", "audit trail"],
    defaultEntities: ["User", "Role", "Record", "AuditEvent"],
    defaultIntegrations: ["SSO", "database", "report export"],
    buildOrder: ["roles", "data model", "tables", "forms", "audit logging", "deployment"]
  },
  "content-platform": {
    label: "Content Platform",
    defaultStack: "Next.js + headless CMS + search + static delivery",
    defaultFeatures: ["publishing workflow", "content taxonomy", "search", "SEO"],
    defaultEntities: ["Author", "Article", "Category", "Tag", "Asset"],
    defaultIntegrations: ["CMS", "search", "image storage", "analytics"],
    buildOrder: ["content schema", "editor workflow", "public pages", "search", "SEO", "deployment"]
  },
  custom: {
    label: "Custom",
    defaultStack: "To be confirmed from requirements",
    defaultFeatures: ["core user journey", "admin or operator workflow", "observability baseline"],
    defaultEntities: ["User", "PrimaryRecord", "AuditEvent"],
    defaultIntegrations: ["database", "auth", "observability"],
    buildOrder: ["requirements", "domain model", "architecture", "core workflow", "testing", "deployment"]
  }
};

const PRIORITY_LABELS: Record<ProjectSeedPriority, string> = {
  "mvp-fast": "MVP rapido",
  "solid-architecture": "Arquitectura solida",
  "low-cost": "Costo bajo",
  "security-first": "Seguridad alta"
};

function cleanList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function listOrDefault(values: string[], defaults: string[]): string[] {
  const cleaned = cleanList(values);
  return cleaned.length > 0 ? cleaned : defaults;
}

function renderList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join("\n") : "- Pending confirmation";
}

function renderNumbered(values: string[]): string {
  return values.length > 0 ? values.map((value, index) => `${index + 1}. ${value}`).join("\n") : "1. Pending confirmation";
}

function normalizeInput(input: ProjectSeedInput): ProjectSeedInput {
  const archetype = ARCHETYPES[input.archetype] ? input.archetype : "custom";
  const definition = ARCHETYPES[archetype];
  return {
    ...input,
    projectName: input.projectName.trim() || "New Project",
    problem: input.problem.trim() || "Pending problem statement.",
    audience: input.audience.trim() || "Pending audience definition.",
    archetype,
    stackPreference: input.stackPreference.trim() || definition.defaultStack,
    features: listOrDefault(input.features, definition.defaultFeatures),
    roles: input.authRequired ? listOrDefault(input.roles, ["owner", "admin", "member"]) : [],
    dataEntities: listOrDefault(input.dataEntities, definition.defaultEntities),
    integrations: listOrDefault(input.integrations, definition.defaultIntegrations),
    language: input.language.trim() || "es",
    notes: cleanList(input.notes),
    contextOnly: true
  };
}

async function writeSeedFile(filePath: string, content: string, overwrite: boolean): Promise<void> {
  if (!overwrite && (await fileExists(filePath))) {
    throw new Error(`Refusing to overwrite existing project seed artifact: ${filePath}. Re-run with --force to replace it.`);
  }

  await writeFileEnsured(filePath, content);
}

function buildCharter(input: ProjectSeedInput): string {
  const definition = ARCHETYPES[input.archetype];
  return `# Project Charter

## Project

- Name: ${input.projectName}
- Archetype: ${definition.label}
- Priority: ${PRIORITY_LABELS[input.priority]}
- Language: ${input.language}

## Problem

${input.problem}

## Audience

${input.audience}

## Intended Outcome

Create a project that can be built from explicit context instead of implicit assumptions. This seed is intentionally context-first: implementation should follow the requirements, architecture, decisions, and runbook in \`AI_CONTEXT/\`.

## Constraints

- Start with reviewable architecture and backlog before writing application code.
- Keep generated context synchronized when scope changes.
- Treat auth, data storage, payments, and deployment as explicit decisions.

## Open Notes

${renderList(input.notes)}
`;
}

function buildRequirements(input: ProjectSeedInput): string {
  return `# Requirements

## Core Features

${renderList(input.features)}

## Users and Roles

${input.authRequired ? renderList(input.roles) : "- No authentication required for the first version."}

## Data Entities

${renderList(input.dataEntities)}

## Integrations

${renderList(input.integrations)}

## Non-Functional Requirements

- Priority mode: ${PRIORITY_LABELS[input.priority]}
- Testing must cover the first critical user journey.
- Logging must be sufficient to debug onboarding and core workflow failures.
- Secrets must live outside source control.
`;
}

function buildProjectBlueprint(input: ProjectSeedInput): string {
  const definition = ARCHETYPES[input.archetype];
  return `# Project Blueprint

## 1. Project Overview

${input.projectName} is a ${definition.label} for ${input.audience}.

Primary problem:

${input.problem}

## 2. Tech Stack

- Preferred stack: ${input.stackPreference}
- Default archetype stack: ${definition.defaultStack}
- Rationale: choose the smallest stack that supports the core workflow, data model, auth needs, and deployment path.

## 3. Directory Structure

\`\`\`text
${input.projectName}/
  AI_CONTEXT/
  docs/
  memory/
  tasks/
  src/
  tests/
\`\`\`

## 4. Data Model

${renderList(input.dataEntities)}

## 5. API Design

- Define API contracts after confirming the data model.
- Validate all backend inputs.
- Keep admin/operator actions separate from public user actions.

## 6. Frontend Architecture

- Start from the core user journey.
- Keep navigation and role-gated screens explicit.
- Add design system decisions before component expansion.

## 7. Design System

- Choose typography, spacing, color, empty states, and error states before building screens.
- For operational tools, prioritize density, scanning, and repeated use.

## 8. Auth and Authorization

${input.authRequired ? renderList(input.roles.map((role) => `${role}: permissions pending confirmation`)) : "- Auth is not required for the initial version."}

## 9. Build Order

${renderNumbered(definition.buildOrder)}

## 10. Environment Setup

- Runtime stack: ${input.stackPreference}
- Required env vars: define after integrations are confirmed.
- Keep \`.env.example\` current when implementation begins.

## 11. Dependencies

- Add dependencies only when a requirement needs them.
- Prefer mature libraries for auth, database access, validation, testing, and payments.

## 12. Deployment

- Choose deployment after stack confirmation.
- Define preview, staging, and production expectations before launch.

## 13. Testing

- Unit tests for core domain rules.
- Integration tests for API/data boundaries.
- Smoke test for the main user journey.

## 14. Skills to Use

- Use frontend and UI skills for screen-heavy projects.
- Use security scan workflows before production exposure.
- Use architecture-plan after any major boundary change.

## 15. Builder Context

Read \`CLAUDE.md\` and \`AI_CONTEXT/MEMORY_BRIEF.md\` before implementation.

## 16. Rules

- Do not invent requirements not captured in this seed.
- Update \`AI_CONTEXT/DECISIONS.md\` when making stack or architecture choices.
- Keep work incremental and verifiable.
`;
}

function buildDecisions(input: ProjectSeedInput): string {
  return `# Decisions

## Accepted

- Project archetype: ${ARCHETYPES[input.archetype].label}
- Priority mode: ${PRIORITY_LABELS[input.priority]}
- Initial stack preference: ${input.stackPreference}
- Context-only generation: yes

## Pending

- Final deployment platform.
- Final auth provider and session strategy.
- Database migration strategy.
- Observability and alerting baseline.
- Payment or billing provider, if applicable.
`;
}

function buildMemoryBrief(input: ProjectSeedInput): string {
  return `# Memory Brief

## Project

- Name: ${input.projectName}
- Archetype: ${ARCHETYPES[input.archetype].label}
- Audience: ${input.audience}
- Priority: ${PRIORITY_LABELS[input.priority]}

## Problem

${input.problem}

## Stack

${input.stackPreference}

## Features

${renderList(input.features)}

## Data

${renderList(input.dataEntities)}

## Integrations

${renderList(input.integrations)}

## Next Best Step

Review \`AI_CONTEXT/PROJECT_BLUEPRINT.md\`, confirm pending decisions in \`AI_CONTEXT/DECISIONS.md\`, then implement the first build-order item.
`;
}

function buildRunbook(input: ProjectSeedInput): string {
  const definition = ARCHETYPES[input.archetype];
  return `# Project Runbook

## Immediate Path

${renderNumbered([
  "Confirm the project charter with the product owner.",
  "Validate data entities and role model.",
  "Choose final stack and deployment target.",
  "Create application scaffold only after decisions are accepted.",
  "Implement one core workflow end-to-end.",
  "Add smoke tests and security checks before expanding scope."
])}

## Build Order

${renderNumbered(definition.buildOrder)}

## Commands After Code Exists

\`\`\`bash
project-brain doctor .
project-brain architecture-plan .
project-brain security-audit .
\`\`\`
`;
}

function buildArchitectureBlueprint(input: ProjectSeedInput): string {
  return `# Architecture Blueprint

## Baseline

- Project: ${input.projectName}
- Archetype: ${ARCHETYPES[input.archetype].label}
- Stack preference: ${input.stackPreference}
- Context source: \`memory/project_seed/project_seed.json\`

## Proposed Boundaries

- UI / presentation
- Application services
- Domain model
- Persistence
- Integrations
- Operations and deployment

## Guardrails

- Keep authorization decisions server-side when auth is enabled.
- Keep integrations behind adapters.
- Do not couple UI components directly to persistence.
- Add observability before exposing production traffic.
`;
}

function buildArchitectureState(input: ProjectSeedInput): string {
  return `# Architecture State

## Current State

- Project seed created.
- Application code not generated by project-brain.
- Architecture is pending user confirmation.

## Open Questions

- Which stack choice is final?
- Which roles and permissions are required for v1?
- Which entities are required for the first workflow?
- Which integrations are mandatory for MVP?

## Source

- \`AI_CONTEXT/PROJECT_CHARTER.md\`
- \`AI_CONTEXT/REQUIREMENTS.md\`
- \`AI_CONTEXT/PROJECT_BLUEPRINT.md\`
`;
}

function buildBacklog(input: ProjectSeedInput): string {
  return `# Initial Backlog

## Now

- Confirm charter and requirements.
- Freeze initial stack and deployment target.
- Model entities: ${input.dataEntities.join(", ")}
- Define first user journey.

## Next

${renderList(input.features.map((feature) => `Implement ${feature}`))}

## Later

- Expand observability.
- Add production security audit.
- Re-run \`project-brain architecture-plan\` after first implementation pass.
`;
}

function buildClaudeContext(input: ProjectSeedInput): string {
  return `# ${input.projectName}

This project was seeded by project-brain.

## Required Reading

1. \`AI_CONTEXT/MEMORY_BRIEF.md\`
2. \`AI_CONTEXT/PROJECT_CHARTER.md\`
3. \`AI_CONTEXT/REQUIREMENTS.md\`
4. \`AI_CONTEXT/PROJECT_BLUEPRINT.md\`
5. \`AI_CONTEXT/DECISIONS.md\`

## Build Rules

- Treat \`AI_CONTEXT/\` as the source of truth until code exists.
- Ask before changing project scope, stack, auth, payments, persistence, or deployment assumptions.
- Keep implementation aligned with \`tasks/initial_backlog.md\`.
`;
}

export async function writeProjectSeedArtifacts(targetPath: string, input: ProjectSeedInput): Promise<ProjectSeedResult> {
  const normalized = normalizeInput(input);
  const overwrite = Boolean(normalized.overwrite);
  const aiContextDir = path.join(targetPath, "AI_CONTEXT");
  const docsArchitectureDir = path.join(targetPath, "docs", "architecture_plan");
  const memoryDir = path.join(targetPath, "memory", "project_seed");
  const tasksDir = path.join(targetPath, "tasks");

  await Promise.all([ensureDir(aiContextDir), ensureDir(docsArchitectureDir), ensureDir(memoryDir), ensureDir(tasksDir)]);

  const artifactPaths = {
    projectCharterPath: path.join(aiContextDir, "PROJECT_CHARTER.md"),
    requirementsPath: path.join(aiContextDir, "REQUIREMENTS.md"),
    blueprintPath: path.join(aiContextDir, "PROJECT_BLUEPRINT.md"),
    decisionsPath: path.join(aiContextDir, "DECISIONS.md"),
    memoryBriefPath: path.join(aiContextDir, "MEMORY_BRIEF.md"),
    runbookPath: path.join(aiContextDir, "RUNBOOK.md"),
    architectureBlueprintPath: path.join(docsArchitectureDir, "BLUEPRINT.md"),
    architectureStatePath: path.join(docsArchitectureDir, "STATE.md"),
    projectSeedMemoryPath: path.join(memoryDir, "project_seed.json"),
    backlogPath: path.join(tasksDir, "initial_backlog.md"),
    claudePath: path.join(targetPath, "CLAUDE.md")
  };

  await writeSeedFile(artifactPaths.projectCharterPath, buildCharter(normalized), overwrite);
  await writeSeedFile(artifactPaths.requirementsPath, buildRequirements(normalized), overwrite);
  await writeSeedFile(artifactPaths.blueprintPath, buildProjectBlueprint(normalized), overwrite);
  await writeSeedFile(artifactPaths.decisionsPath, buildDecisions(normalized), overwrite);
  await writeSeedFile(artifactPaths.memoryBriefPath, buildMemoryBrief(normalized), overwrite);
  await writeSeedFile(artifactPaths.runbookPath, buildRunbook(normalized), overwrite);
  await writeSeedFile(artifactPaths.architectureBlueprintPath, buildArchitectureBlueprint(normalized), overwrite);
  await writeSeedFile(artifactPaths.architectureStatePath, buildArchitectureState(normalized), overwrite);
  await writeSeedFile(artifactPaths.backlogPath, buildBacklog(normalized), overwrite);
  await writeSeedFile(artifactPaths.claudePath, buildClaudeContext(normalized), overwrite);
  await writeJsonEnsured(artifactPaths.projectSeedMemoryPath, {
    generatedAt: new Date().toISOString(),
    source: "project-brain project_seed",
    referencePattern: "the-architect-style guided blueprint adapted to AI_CONTEXT",
    input: normalized
  });

  return {
    targetPath,
    projectName: normalized.projectName,
    archetype: normalized.archetype,
    contextOnly: normalized.contextOnly,
    artifactPaths,
    nextSteps: [
      "Review AI_CONTEXT/PROJECT_CHARTER.md and AI_CONTEXT/REQUIREMENTS.md.",
      "Confirm pending decisions in AI_CONTEXT/DECISIONS.md.",
      "Use tasks/initial_backlog.md to start implementation in small verified steps."
    ]
  };
}
