import { BaseAgent } from "../base-agent";
import { analyzeDevelopmentArchitecture } from "../../tools/dev_analysis_tools";
import { generatePatchProposals } from "../../tools/patch_proposal_tools";
import { readTextSafe, writeFileEnsured } from "../../shared/fs-utils";

import type { AgentEvaluation, AgentReport, PatchProposalArtifact, ProjectContext } from "../../shared/types";

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderMetricList(
  items: Array<{
    filePath: string;
    lineCount: number;
    couplingScore: number;
    complexityScore: number;
    changeSignal: string;
    changeFrequency: number;
  }>
): string {
  return items.length > 0
    ? items
        .map(
          (item) =>
            `- ${item.filePath} (${item.lineCount} lines, coupling ${item.couplingScore}, complexity ${item.complexityScore}, change ${item.changeFrequency} via ${item.changeSignal})`
        )
        .join("\n")
    : "- None";
}

function renderRiskList(
  items: Array<{
    severity: string;
    title: string;
    problemDescription: string;
    affectedFiles: string[];
    suggestedChange: string;
    estimatedDifficulty: string;
    confidenceScore: number;
  }>
): string {
  return items.length > 0
    ? items
        .map(
          (item, index) => `### ${index + 1}. [${item.severity.toUpperCase()}] ${item.title}

- Problem: ${item.problemDescription}
- Affected files: ${item.affectedFiles.join(", ") || "None"}
- Suggested change: ${item.suggestedChange}
- Estimated difficulty: ${item.estimatedDifficulty}
- Confidence: ${item.confidenceScore}`
        )
        .join("\n\n")
    : "No architecture risks were identified in this cycle.";
}

export class DevAgent extends BaseAgent {
  constructor() {
    super("dev-agent", "dev_architecture_analysis.md");
  }

  async run(context: ProjectContext): Promise<AgentReport> {
    const report = await super.run(context);
    const patchProposals = await generatePatchProposals(context, this.agentId);

    await this.appendPatchProposalStage(report, patchProposals);

    if (patchProposals.length > 0) {
      this.logger.info("Workflow stage completed", {
        action: "workflow_stage_complete",
        stage: "PROPOSE_PATCHES",
        repoName: context.repoName,
        patchProposals: patchProposals.length,
        patchProposalDir: context.patchProposalDir
      });
    } else {
      this.logger.info("Workflow stage skipped", {
        action: "workflow_stage_skipped",
        stage: "PROPOSE_PATCHES",
        repoName: context.repoName,
        reason: "No UX_IMPLEMENTATION_TASKS.md source file was available for patch proposal generation."
      });
    }

    return report;
  }

  private async appendPatchProposalStage(report: AgentReport, patchProposals: PatchProposalArtifact[]): Promise<void> {
    const currentContent = await readTextSafe(report.outputPath);
    const stageContent =
      patchProposals.length > 0
        ? `## PROPOSE_PATCHES

- Source: UX_IMPLEMENTATION_TASKS.md
- Human approval required: yes
- Patch proposals generated: ${patchProposals.length}

${renderList(
            patchProposals.map(
              (proposal) => `${proposal.patchId} -> ${proposal.targetFile} | path=${proposal.filePath}`
            )
          )}
`
        : `## PROPOSE_PATCHES

- Source: UX_IMPLEMENTATION_TASKS.md
- Human approval required: yes
- Patch proposals generated: 0
- Stage result: skipped because no implementation task report was available.
`;

    await writeFileEnsured(report.outputPath, `${currentContent.trim()}\n\n${stageContent}`);
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const analysis = await analyzeDevelopmentArchitecture(context);
    const findings = analysis.topArchitectureRisks.map(
      (risk) => `[${risk.severity.toUpperCase()}] ${risk.title}: ${risk.problemDescription}`
    );
    const recommendations = analysis.actionableProposals.map(
      (proposal) =>
        `${proposal.title} -> ${proposal.suggestedChange} (files: ${proposal.affectedFiles.join(", ") || "None"}; difficulty: ${proposal.estimatedDifficulty}; confidence: ${proposal.confidenceScore})`
    );
    const riskLevel =
      analysis.topArchitectureRisks.some((risk) => risk.severity === "high")
        ? "high"
        : analysis.topArchitectureRisks.some((risk) => risk.severity === "medium")
          ? "medium"
          : "low";
    const content = `# Dev Architecture Analysis

## Summary

${analysis.moduleCount} modules were analyzed with dependency-cruiser, ts-prune, and ESLint. The dependency graph has ${analysis.dependencyGraph.nodes} local nodes and ${analysis.dependencyGraph.edges} local edges, with a coupling index of ${analysis.dependencyGraph.couplingIndex}.

## Structural Metrics

- Number of modules: ${analysis.moduleCount}
- Dependency graph: ${analysis.dependencyGraph.nodes} local nodes / ${analysis.dependencyGraph.edges} local edges
- Coupling index: ${analysis.dependencyGraph.couplingIndex}
- Circular dependencies: ${analysis.dependencyGraph.circularDependencies.length}
- Unused exports: ${analysis.unusedExports.length}
- Largest modules over 500 lines: ${analysis.eslintSummary.oversizedFiles.length}

## Top 10 Architecture Risks

${renderRiskList(analysis.topArchitectureRisks)}

## Refactoring Suggestions

${renderList(recommendations)}

## Modules With Highest Complexity

${renderMetricList(analysis.complexityHotspots)}

## Modules Recommended For Isolation

${renderMetricList(analysis.isolationCandidates)}

## Architectural Observations

${renderList(analysis.architectureObservations)}

## Static Analysis Snapshot

- dependency-cruiser: ${analysis.notes[0]}
- ts-prune: ${analysis.notes[1]}
- ESLint: ${analysis.notes[2]}
- Circular dependency paths: ${
      analysis.dependencyGraph.circularDependencies.length > 0
        ? analysis.dependencyGraph.circularDependencies.map((path) => path.join(" -> ")).join("; ")
        : "None"
    }
- Largest modules: ${analysis.largestModules.map((metric) => `${metric.filePath} (${metric.lineCount} lines)`).join(", ") || "None"}
- Highest change hotspots: ${analysis.changeHotspots.map((metric) => `${metric.filePath} (${metric.changeFrequency})`).join(", ") || "None"}
- Missing logging candidates: ${analysis.missingLogging.map((metric) => metric.filePath).join(", ") || "None"}
- Missing error handling candidates: ${analysis.missingErrorHandling.map((metric) => metric.filePath).join(", ") || "None"}
- Unused exports: ${
      analysis.unusedExports.length > 0
        ? analysis.unusedExports.map((entry) => `${entry.filePath} -> ${entry.symbol}`).join(", ")
        : "None"
    }
`;

    return {
      title: "Dev Architecture Analysis",
      summary: "DevAgent evaluated architectural hotspots, static-analysis findings, and code-level maintainability risks.",
      findings,
      recommendations,
      riskLevel,
      content
    };
  }
}
