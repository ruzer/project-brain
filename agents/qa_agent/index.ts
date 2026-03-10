import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

export class QAAgent extends BaseAgent {
  constructor() {
    super("qa-agent", "qa_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;
    const testFiles = discovery.structure.testFileCount;
    const sourceFiles = discovery.structure.sourceFileCount;

    if (discovery.testing.length === 0) {
      findings.push("No automated test framework was detected.");
      recommendations.push("Adopt a baseline automated test framework aligned with the primary runtime.");
    }

    if (sourceFiles > 20 && testFiles === 0) {
      findings.push("The repository has source-heavy areas without any test files.");
      recommendations.push("Start with smoke tests around the highest-change modules and API entry points.");
    }

    if (sourceFiles > 0 && testFiles > 0 && sourceFiles / testFiles > 8) {
      findings.push("The test-to-source ratio suggests thin coverage on critical paths.");
      recommendations.push("Expand coverage on authentication, data access, and integration seams first.");
    }

    if ((discovery.apis.includes("REST") || discovery.apis.includes("GraphQL")) && testFiles === 0) {
      findings.push("Exposed API surfaces appear to be untested.");
      recommendations.push("Add route-level or schema-level contract tests for the public API.");
    }

    return {
      title: "QA Report",
      summary: `QAAgent reviewed ${sourceFiles} source files and ${testFiles} test files.`,
      findings,
      recommendations,
      riskLevel: findings.length >= 2 ? "high" : findings.length === 1 ? "medium" : "low"
    };
  }
}
