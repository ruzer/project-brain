import path from "node:path";

import { ensureDir, uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ProjectContext, ArchitecturePlanResult } from "../../shared/types";

interface ArchitectureLayerSignal {
  layer: string;
  evidence: string[];
}

interface ArchitectureState {
  generatedAt: string;
  repoName: string;
  targetPath: string;
  outputPath: string;
  languages: string[];
  frameworks: string[];
  apis: string[];
  infrastructure: string[];
  testing: string[];
  logging: string[];
  metrics: string[];
  fileCount: number;
  sourceFileCount: number;
  testFileCount: number;
  layers: ArchitectureLayerSignal[];
  risks: string[];
}

function cleanLabel(value: string): string {
  return value.trim();
}

function toListLines(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None found.";
}

function pickTopEvidence(items: string[], maxItems = 8): string[] {
  return items.slice(0, maxItems);
}

function detectLayers(context: ProjectContext): ArchitectureLayerSignal[] {
  const files = context.discovery.files;
  const layers: ArchitectureLayerSignal[] = [];

  const frontendEvidence = pickTopEvidence(
    files.filter(
      (filePath) =>
        /(^|\/)(app|src)\/(app|pages|components|views|layouts?)\//i.test(filePath) ||
        /^src\/components\//i.test(filePath) ||
        /^public\//i.test(filePath) ||
        /(^|\/)components\//i.test(filePath) ||
        /(^|\/)views\//i.test(filePath)
    )
  );
  if (frontendEvidence.length > 0) {
    layers.push({
      layer: "Frontend",
      evidence: pickTopEvidence(frontendEvidence)
    });
  }

  const backendEvidence = pickTopEvidence(
    files.filter(
      (filePath) =>
        /(^|\/)(src|app)\/(api|controllers|routes|middlewares?)\//i.test(filePath) ||
        /(^|\/)(api|routes|controllers|services)\//i.test(filePath) ||
        /(^|\/)backend\//i.test(filePath) ||
        /(^|\/)(default\/)?app\/controllers\//i.test(filePath)
    )
  );
  if (backendEvidence.length > 0) {
    layers.push({
      layer: "Backend/API",
      evidence: pickTopEvidence(backendEvidence)
    });
  }

  const dataEvidence = pickTopEvidence(
    files.filter(
      (filePath) =>
        /(^|\/)(schemas?|models?|repositories?|entities?|migrations?|scripts?)\//i.test(filePath) ||
        /\.(sql|prisma|graphql)$/i.test(filePath) ||
        /(^|\/)db\//i.test(filePath)
    )
  );
  if (dataEvidence.length > 0) {
    layers.push({
      layer: "Data/Storage",
      evidence: pickTopEvidence(dataEvidence)
    });
  }

  const infraEvidence = pickTopEvidence(
    files.filter(
      (filePath) =>
        /(^|\/)(deploy|infrastructure|ops|ci|.github|docker|kubernetes)\//i.test(filePath) ||
        /(^|\/)(docker|k8s|helm|terraform|ansible)\./i.test(filePath)
    )
  );
  if (infraEvidence.length > 0) {
    layers.push({
      layer: "Operations",
      evidence: pickTopEvidence(infraEvidence)
    });
  }

  const workerEvidence = pickTopEvidence(
    files.filter(
      (filePath) =>
        /(^|\/)(jobs?|workers?|cron|tasks?|queues?|scheduler|events?)\//i.test(filePath) ||
        /(^|\/)(cron|jobs)\//i.test(filePath)
    )
  );
  if (workerEvidence.length > 0) {
    layers.push({
      layer: "Workers/Jobs",
      evidence: pickTopEvidence(workerEvidence)
    });
  }

  const cliEvidence = pickTopEvidence(
    files.filter((filePath) => /(^|\/)(scripts|bin|cli|tools?)\//i.test(filePath))
  );
  if (cliEvidence.length > 0) {
    layers.push({
      layer: "CLI/DevOps Tooling",
      evidence: pickTopEvidence(cliEvidence)
    });
  }

  const genericEvidence = pickTopEvidence(
    files.filter((filePath) => /(^|\/)(config|docs|tests?|spec)\//i.test(filePath))
  );
  if (layers.length === 0 && genericEvidence.length > 0) {
    layers.push({
      layer: "Core Application",
      evidence: pickTopEvidence(genericEvidence)
    });
  }

  return [...layers]
    .sort((left, right) => left.layer.localeCompare(right.layer))
    .filter((layer, index, sortedLayers) =>
      sortedLayers.findIndex((candidate) => candidate.layer === layer.layer) === index
    );
}

function buildRisks(context: ProjectContext): string[] {
  const signals = context.discovery.recommendations;
  const infrastructureFlags = signals
    .filter((signal) => /op(s|eration|eración)|infra|deploy|ci|cicd|secrets?/i.test(signal))
    .slice(0, 5);
  const architectureFlags = signals.filter((signal) =>
    /\bboundary|module|coupl|drift|architecture|refactor|ownership|governance/i.test(signal)
  );
  const risks = uniqueSorted([
    ...infrastructureFlags,
    ...architectureFlags,
    ...(context.discovery.structure.topLevelDirectories.length > 10
      ? ["Repository has high top-level breadth; module boundaries may be too coupled."]
      : []),
    ...(context.discovery.structure.subrepos.length > 1 ? ["Nested sub-repos detected; integration boundaries need explicit ownership."] : []),
    ...(context.discovery.dependencies.length === 0 ? ["No dependency manifest detected; dependency-based risk visibility is limited."] : []),
    ...(!context.discovery.infrastructure.some((value) => /monitor|observ|metric|telemet/i.test(value))
      ? ["No explicit runtime observability system was detected from discovery."]
      : [])
  ]);
  return uniqueSorted(risks).slice(0, 8);
}

function buildCurrentState(context: ProjectContext, layers: ArchitectureLayerSignal[]): string {
  return `# Architecture State (${context.repoName})

## Repository Snapshot

- Repository: ${context.repoName}
- Target: ${context.targetPath}
- Output: ${context.outputPath}
- Languages: ${context.discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${context.discovery.frameworks.join(", ") || "Unknown"}
- API surface: ${context.discovery.apis.join(", ") || "Not explicitly detected"}
- Infrastructure: ${context.discovery.infrastructure.join(", ") || "Not explicitly detected"}
- Testing: ${context.discovery.testing.join(", ") || "Not explicitly detected"}
- Files scanned: ${context.discovery.structure.fileCount}
- Source files: ${context.discovery.structure.sourceFileCount}
- Test files: ${context.discovery.structure.testFileCount}

## Inferred Layers

${layers
  .map((layer) => `### ${cleanLabel(layer.layer)}\n${toListLines(pickTopEvidence(layer.evidence, 4))}`)
  .join("\n\n") || "No strong layer evidence was detected in this repository."}
`;
}

function buildBlueprint(context: ProjectContext, layers: ArchitectureLayerSignal[]): string {
  const risks = buildRisks(context);
  const discoverySignals = uniqueSorted([
    ...context.discovery.recommendations,
    ...context.discovery.logging.frameworks,
    ...context.discovery.metrics.tools,
    ...context.discovery.infrastructure
  ]);

  return `# ${context.repoName} Architecture Blueprint

## 1) Real architecture (evidence-backed)

${buildCurrentState(context, layers)}

## 2) Boundary and responsibility proposal

1. Keep existing top-level functional domains as temporary bounded contexts until explicit module boundaries are approved.
2. Route all cross-layer calls through narrow service interfaces and avoid direct DB/framework coupling in UI logic.
3. Define ownership for: API contracts, data models, and operations/tooling before major refactors.

## 3) Confirmed contracts and assumptions

  ${toListLines(discoverySignals.slice(0, 10))}

## 4) Key risks detected

${toListLines(risks)}

## 5) Evolution plan (30/60/90)

- **Phase 1 (0-30):** Lock architecture evidence (\`project-brain context-lite\`, \`project-brain architecture-plan\`) and stop adding new high-risk module coupling.
- **Phase 2 (30-60):** Create/validate explicit boundaries for high-touch areas and define API contracts for each boundary.
- **Phase 3 (60-90):** Migrate orchestration to smaller modules and add regression tests before removing legacy seams.

## 6) Build order (recommended)

1. Generate evidence artifacts for every critical boundary (\`project-brain context-lite\`, \`project-brain architecture-plan\`).
2. Define module ownership and event/data boundaries in \`docs/architecture_plan/STATE.md\`.
3. Align implementation with contracts in one layer at a time.
4. Add regression validations before moving to next layer.
5. Re-run \`project-brain architecture-plan\` and \`project-brain plan-improvements\` after each major boundary change.

## 7) Suggested guardrails

- Do not replace architecture before the evidence snapshot is consistent for three consecutive runs.
- Require review for proposals touching auth, identity, persistence, and deployment files.
- Keep generated temporary state and CLAUDE context synced with this blueprint.
`;
}

function buildState(context: ProjectContext, layers: ArchitectureLayerSignal[]): string {
  const normalizedLayers = layers.map((layer) => layer.layer).join(", ") || "Unknown";
  return `# Architecture Evolution State

## Baseline

- Repository: ${context.repoName}
- Last sync: ${new Date().toISOString()}
- Current baseline: ${context.discovery.frameworks.join(", ") || "Unknown"} in ${context.discovery.languages.join(", ") || "Unknown"}
- Top-level layers detected: ${normalizedLayers}
- Source files: ${context.discovery.structure.sourceFileCount}
- CI/infra signals: ${context.discovery.infrastructure.join(", ") || "None"}

## Snapshot Notes

- File density: ${context.discovery.structure.fileCount} total files
- Subrepos: ${context.discovery.structure.subrepos.join(", ") || "None"}
- Structure depth: ${context.discovery.structure.topLevelDirectories.length}
- Memory output: ${context.memoryDir}
- Last updated by: project-brain architecture-plan

## Open architectural questions

1. Which boundaries are owner-driven (team ownership vs. technical ownership)?
2. Which contracts are stable enough to freeze before refactors?
3. Which subsystems can remain coupled while risk is reduced elsewhere?

## Next checkpoint

- Add this file to your change control and require a review when changing cross-layer calls.
`;
}

function buildClaudeContext(context: ProjectContext, layers: ArchitectureLayerSignal[]): string {
  return `# ${context.repoName} - CLAUDE Working Context

Use this file as execution context for targeted architecture-aligned improvements.

## Ground truth

- Do not assume files that are not present in the repository.
- Stack detected: ${context.discovery.languages.join(", ") || "Unknown"} with frameworks ${context.discovery.frameworks.join(", ") || "Unknown"}.
- Top-level responsibilities inferred: ${layers.map((layer) => layer.layer).join(", ") || "Unknown"}.

## Working rules

- Keep changes scoped to one boundary at a time.
- Preserve contracts first, then optimize internals.
- Validate each boundary with deterministic artifacts before broad refactors.

## Fast start

1. Read \`docs/architecture_plan/BLUEPRINT.md\`
2. Read \`docs/architecture_plan/STATE.md\`
3. Review \`reports\` artifacts before proposing code changes.
4. Update this context only when execution evidence changes materially.

## Hard constraints

- Avoid changing persistence, auth, and deployment files in one pass without rollback plan.
- Keep this project brain artifact directory (\`reports\`, \`docs\`, \`memory\`, \`AI_CONTEXT\`) separated from app source.
`;
}

function summarizeFiles(context: ProjectContext): ArchitectureState {
  return {
    generatedAt: new Date().toISOString(),
    repoName: context.repoName,
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    languages: context.discovery.languages,
    frameworks: context.discovery.frameworks,
    apis: context.discovery.apis,
    infrastructure: context.discovery.infrastructure,
    testing: context.discovery.testing,
    logging: context.discovery.logging.frameworks,
    metrics: context.discovery.metrics.tools,
    fileCount: context.discovery.structure.fileCount,
    sourceFileCount: context.discovery.structure.sourceFileCount,
    testFileCount: context.discovery.structure.testFileCount,
    layers: detectLayers(context),
    risks: buildRisks(context)
  };
}

export async function writeArchitecturePlanArtifacts(context: ProjectContext): Promise<ArchitecturePlanResult> {
  const planDir = path.join(context.docsDir, "architecture_plan");
  const blueprintPath = path.join(planDir, "BLUEPRINT.md");
  const statePath = path.join(planDir, "STATE.md");
  const claudePath = path.join(planDir, "CLAUDE.md");
  const memoryPath = path.join(context.runtimeMemoryDir, "architecture_plan", "architecture_plan.json");
  const architectureState = summarizeFiles(context);
  const layers = architectureState.layers;

  await ensureDir(planDir);

  const blueprint = buildBlueprint(context, layers);
  const state = buildState(context, layers);
  const claudeContext = buildClaudeContext(context, layers);

  await writeFileEnsured(blueprintPath, blueprint);
  await writeFileEnsured(statePath, state);
  await writeFileEnsured(claudePath, claudeContext);
  await writeJsonEnsured(memoryPath, architectureState);

  return {
    context,
    planDir,
    blueprintPath,
    statePath,
    claudeContextPath: claudePath,
    memoryPath
  };
}
