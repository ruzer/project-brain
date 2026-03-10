import path from "node:path";

import type { ProjectContext, RiskLevel } from "../../shared/types";
import {
  emptyDevArchitectureAnalysis,
  isSourceFile,
  roundMetric,
  RUNTIME_PREFIXES,
  severityWeight
} from "./contracts";
import type {
  DependencyCruiserModule,
  DevArchitectureAnalysis,
  DevArchitectureProposal,
  Difficulty,
  ModuleMetric
} from "./contracts";
import { runDependencyCruiser, runEslint, runTsPrune, readGitChangeFrequency, resolveProjectBrainRoot } from "./runners";
import { findDuplicationClusters, loadSnapshots } from "./snapshots";

function buildModuleMetrics(
  snapshots: Awaited<ReturnType<typeof loadSnapshots>>,
  graph: DevArchitectureAnalysis["dependencyGraph"],
  modules: DependencyCruiserModule[],
  gitChangeFrequency: Map<string, number> | undefined,
  eslintSummary: DevArchitectureAnalysis["eslintSummary"]
): ModuleMetric[] {
  const moduleMap = new Map(modules.map((moduleInfo) => [moduleInfo.source, moduleInfo]));

  return snapshots
    .map((snapshot) => {
      const moduleInfo = moduleMap.get(snapshot.filePath);
      const inboundDependencies = (moduleInfo?.dependents ?? []).filter((filePath) => isSourceFile(filePath)).length;
      const outboundDependencies = new Set(
        (moduleInfo?.dependencies ?? [])
          .map((dependency) => dependency.resolved)
          .filter((filePath): filePath is string => typeof filePath === "string" && isSourceFile(filePath))
      ).size;
      const complexityScore =
        snapshot.lineCount / 30 +
        inboundDependencies * 1.5 +
        outboundDependencies +
        snapshot.duplicateBlocks * 1.5 +
        (eslintSummary.complexityWarnings.includes(snapshot.filePath) ? 4 : 0);
      const performanceScore =
        snapshot.lineCount / 35 +
        graph.couplingIndex +
        inboundDependencies * 1.2 +
        snapshot.duplicateBlocks +
        (snapshot.requiresErrorHandling && !snapshot.hasErrorHandling ? 2 : 0);
      const fallbackChangeSignal =
        inboundDependencies * 4 +
        outboundDependencies * 3 +
        Math.ceil(snapshot.lineCount / 40) +
        snapshot.duplicateBlocks * 2;

      return {
        filePath: snapshot.filePath,
        lineCount: snapshot.lineCount,
        inboundDependencies,
        outboundDependencies,
        couplingScore: inboundDependencies + outboundDependencies,
        duplicateBlocks: snapshot.duplicateBlocks,
        changeFrequency: gitChangeFrequency?.get(snapshot.filePath) ?? fallbackChangeSignal,
        changeSignal: gitChangeFrequency ? "git-history" : "coupling-size-proxy",
        complexityScore: roundMetric(complexityScore),
        performanceScore: roundMetric(performanceScore),
        hasStructuredLogging: snapshot.hasStructuredLogging,
        hasErrorHandling: snapshot.hasErrorHandling
      };
    })
    .sort((left, right) => right.complexityScore - left.complexityScore || right.lineCount - left.lineCount);
}

function buildProposal(
  severity: RiskLevel,
  title: string,
  problemDescription: string,
  affectedFiles: string[],
  suggestedChange: string,
  estimatedDifficulty: Difficulty,
  confidenceScore: number
): DevArchitectureProposal {
  return {
    severity,
    title,
    problemDescription,
    affectedFiles: [...new Set(affectedFiles)].sort((left, right) => left.localeCompare(right)),
    suggestedChange,
    estimatedDifficulty,
    confidenceScore: roundMetric(confidenceScore)
  };
}

function sortProposals(proposals: DevArchitectureProposal[]): DevArchitectureProposal[] {
  return [...proposals]
    .sort((left, right) => {
      const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
      if (severityDelta !== 0) {
        return severityDelta;
      }

      return right.confidenceScore - left.confidenceScore;
    })
    .slice(0, 10);
}

export async function analyzeDevelopmentArchitecture(context: ProjectContext): Promise<DevArchitectureAnalysis> {
  const packageRoot = resolveProjectBrainRoot(__dirname);
  const sourceFiles = context.discovery.files.filter(isSourceFile);

  if (sourceFiles.length === 0) {
    return emptyDevArchitectureAnalysis(
      "No TypeScript or JavaScript modules were detected, so DevAgent skipped the static-analysis toolchain for this cycle."
    );
  }

  const snapshots = await loadSnapshots(context.targetPath, sourceFiles);
  const duplicationClusters = findDuplicationClusters(snapshots);
  const depCruiseResult = runDependencyCruiser(packageRoot, context.targetPath, sourceFiles);
  const depCruiseOutput = depCruiseResult.output ?? { modules: [] };
  const localModules = depCruiseOutput.modules.filter((moduleInfo) => isSourceFile(moduleInfo.source));
  const localEdges = localModules.reduce(
    (count, moduleInfo) =>
      count +
      new Set(
        (moduleInfo.dependencies ?? [])
          .map((dependency) => dependency.resolved)
          .filter((filePath): filePath is string => typeof filePath === "string" && isSourceFile(filePath))
      ).size,
    0
  );
  const circularDependencies = [...new Set(
    localModules.flatMap((moduleInfo) =>
      (moduleInfo.dependencies ?? [])
        .filter((dependency) => dependency.circular && dependency.resolved && isSourceFile(dependency.resolved))
        .map((dependency) => `${moduleInfo.source}|${dependency.resolved as string}`)
    )
  )]
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => entry.split("|"));
  const orphanModules = localModules
    .filter((moduleInfo) => moduleInfo.orphan)
    .map((moduleInfo) => moduleInfo.source)
    .sort((left, right) => left.localeCompare(right));
  const couplingIndex = localModules.length === 0 ? 0 : roundMetric((localEdges * 2) / localModules.length);
  const eslintSummary = runEslint(packageRoot, context.targetPath, sourceFiles);
  const tsPruneResult = runTsPrune(packageRoot, context.targetPath);
  const gitChangeFrequency = context.discovery.git.isGitRepo ? readGitChangeFrequency(context.targetPath) : undefined;
  const moduleMetrics = buildModuleMetrics(
    snapshots,
    {
      nodes: localModules.length,
      edges: localEdges,
      couplingIndex,
      circularDependencies,
      orphanModules,
      totalCruised: depCruiseOutput.summary?.totalCruised ?? localModules.length,
      totalDependenciesCruised: depCruiseOutput.summary?.totalDependenciesCruised ?? localEdges
    },
    localModules,
    gitChangeFrequency,
    eslintSummary
  );
  const largestModules = [...moduleMetrics].sort((left, right) => right.lineCount - left.lineCount).slice(0, 5);
  const changeHotspots = [...moduleMetrics]
    .sort((left, right) => right.changeFrequency - left.changeFrequency || right.couplingScore - left.couplingScore)
    .slice(0, 5);
  const complexityHotspots = [...moduleMetrics]
    .sort((left, right) => right.complexityScore - left.complexityScore || right.lineCount - left.lineCount)
    .slice(0, 5);
  const isolationCandidates = [...moduleMetrics]
    .filter((metric) => metric.lineCount >= 100 && metric.couplingScore >= 3)
    .sort((left, right) => right.couplingScore - left.couplingScore || right.lineCount - left.lineCount)
    .slice(0, 5);
  const missingErrorHandling = moduleMetrics
    .filter((metric) => {
      const snapshot = snapshots.find((candidate) => candidate.filePath === metric.filePath);
      return Boolean(
        snapshot?.requiresErrorHandling &&
          !snapshot.hasErrorHandling &&
          !snapshot.isTypeOnlyModule &&
          !metric.filePath.startsWith("tools/dev_analysis_tools/")
      );
    })
    .sort((left, right) => right.lineCount - left.lineCount)
    .slice(0, 5);
  const missingLogging = moduleMetrics
    .filter((metric) => {
      const snapshot = snapshots.find((candidate) => candidate.filePath === metric.filePath);
      return Boolean(
        snapshot &&
          !snapshot.isTypeOnlyModule &&
          !snapshot.hasStructuredLogging &&
          !metric.filePath.startsWith("tools/dev_analysis_tools/") &&
          RUNTIME_PREFIXES.some((prefix) => metric.filePath.startsWith(prefix)) &&
          (metric.lineCount >= 90 || metric.couplingScore >= 3)
      );
    })
    .sort((left, right) => right.couplingScore - left.couplingScore || right.lineCount - left.lineCount)
    .slice(0, 5);

  const proposals: DevArchitectureProposal[] = [];

  if (circularDependencies.length > 0) {
    proposals.push(
      buildProposal(
        "high",
        "Break circular module dependencies",
        `dependency-cruiser detected ${circularDependencies.length} circular dependency path(s), which increases change risk and obscures ownership.`,
        circularDependencies.flat(),
        "Introduce an explicit boundary module or invert imports so each runtime flow depends on a single direction.",
        "medium",
        0.91
      )
    );
  }

  const dominantRuntimeHotspots = isolationCandidates
    .filter((metric) => metric.filePath.startsWith("core/") || metric.filePath.startsWith("governance/") || metric.filePath.startsWith("memory/"))
    .slice(0, 2);

  for (const hotspot of dominantRuntimeHotspots) {
    proposals.push(
      buildProposal(
        hotspot.lineCount >= 300 ? "high" : "medium",
        `Isolate ${path.posix.basename(hotspot.filePath)} responsibilities`,
        `${hotspot.filePath} combines ${hotspot.lineCount} lines with a coupling score of ${hotspot.couplingScore}, making it a high-friction change hotspot.`,
        [hotspot.filePath],
        "Split planning, execution, persistence, and report rendering responsibilities into narrower services with explicit interfaces.",
        hotspot.lineCount >= 300 ? "high" : "medium",
        hotspot.lineCount >= 300 ? 0.9 : 0.78
      )
    );
  }

  if (duplicationClusters.length > 0) {
    proposals.push(
      buildProposal(
        "medium",
        "Extract repeated agent analysis scaffolding",
        `The duplication scan found ${duplicationClusters[0].occurrences} modules repeating the same evaluation skeleton, which will make agent behavior harder to evolve consistently.`,
        duplicationClusters[0].filePaths,
        "Move repeated findings/recommendations setup into shared helper utilities or richer base-agent primitives before adding more specialist heuristics.",
        "medium",
        0.82
      )
    );
  }

  if (tsPruneResult.unusedExports.length > 0) {
    proposals.push(
      buildProposal(
        "medium",
        "Prune unused public exports",
        `ts-prune reported ${tsPruneResult.unusedExports.length} unused export(s), which increases public API surface without delivering value.`,
        tsPruneResult.unusedExports.slice(0, 6).map((entry) => entry.filePath),
        "Remove compatibility re-exports that are no longer consumed, or document them as intentional public API contracts.",
        "low",
        0.86
      )
    );
  }

  if (missingErrorHandling.length > 0) {
    proposals.push(
      buildProposal(
        "medium",
        "Add explicit runtime error boundaries",
        "Several high-signal modules perform async or file-system work without visible try/catch or promise error boundaries.",
        missingErrorHandling.slice(0, 4).map((metric) => metric.filePath),
        "Wrap repository IO, manifest parsing, and orchestration transitions in explicit error boundaries that preserve context and failure cause.",
        "medium",
        0.77
      )
    );
  }

  if (missingLogging.length > 0) {
    proposals.push(
      buildProposal(
        "medium",
        "Instrument key runtime boundaries with structured logs",
        "Critical runtime modules with high fan-in or fan-out still operate without structured logging, reducing diagnosability during continuous analysis.",
        missingLogging.slice(0, 4).map((metric) => metric.filePath),
        "Add structured lifecycle logs around discovery, parsing, message coordination, and persistence boundaries so failures can be traced by cycle and module.",
        "low",
        0.74
      )
    );
  }

  if (context.discovery.structure.subrepos.length > 2) {
    proposals.push(
      buildProposal(
        "low",
        "Formalize ownership for nested packages",
        "Multiple nested packages were detected without strong architectural controls, which will amplify coupling drift over time.",
        context.discovery.structure.subrepos,
        "Define ownership boundaries and cross-package contracts for each nested runtime.",
        "medium",
        0.65
      )
    );
  }

  const topArchitectureRisks = sortProposals(proposals);
  const architectureObservations = [
    circularDependencies.length === 0
      ? "The local dependency graph is currently acyclic; the main maintainability risk is centralization in a few runtime hubs, not dependency loops."
      : "Circular dependencies exist in the local graph and should be treated as a primary architectural hazard.",
    dominantRuntimeHotspots.length > 0
      ? `${dominantRuntimeHotspots
          .map((metric) => `${metric.filePath} (${metric.lineCount} lines, coupling ${metric.couplingScore})`)
          .join(", ")} currently dominate orchestration and state flow.`
      : "No dominant runtime hotspot crossed the isolation threshold in this cycle.",
    context.discovery.git.isGitRepo
      ? "Change hotspots are based on Git history over the latest 150 commits."
      : "Git history was not available, so change hotspots were approximated from coupling, file size, and duplicate blocks."
  ];
  const notes = [
    depCruiseResult.error ? `dependency-cruiser fallback: ${depCruiseResult.error}` : "dependency-cruiser completed successfully.",
    tsPruneResult.error ? `ts-prune fallback: ${tsPruneResult.error}` : "ts-prune completed successfully.",
    eslintSummary.error ? `ESLint fallback: ${eslintSummary.error}` : "ESLint completed successfully."
  ];

  return {
    moduleCount: sourceFiles.length,
    dependencyGraph: {
      nodes: localModules.length,
      edges: localEdges,
      couplingIndex,
      circularDependencies,
      orphanModules,
      totalCruised: depCruiseOutput.summary?.totalCruised ?? localModules.length,
      totalDependenciesCruised: depCruiseOutput.summary?.totalDependenciesCruised ?? localEdges
    },
    largestModules,
    complexityHotspots,
    isolationCandidates,
    changeHotspots,
    missingErrorHandling,
    missingLogging,
    unusedExports: tsPruneResult.unusedExports.filter((entry) => isSourceFile(entry.filePath)),
    duplicationClusters,
    architectureObservations,
    topArchitectureRisks,
    actionableProposals: topArchitectureRisks.filter((proposal) => proposal.severity !== "low").slice(0, 5),
    eslintSummary,
    notes
  };
}
