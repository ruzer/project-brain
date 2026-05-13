import { describe, expect, it } from "vitest";

import { structuralConsensus } from "../../governance/proposal-consensus";
import type { AgentReport } from "../../shared/types";

function report(agentId: string, findings: string[]): AgentReport {
  return {
    agentId,
    title: `${agentId} report`,
    summary: findings.join(" "),
    findings,
    recommendations: [],
    riskLevel: "medium",
    outputPath: `/tmp/${agentId}.md`
  };
}

describe("structural proposal consensus", () => {
  it("elevates consensus when two agents cite the same file and issue type", () => {
    const consensus = structuralConsensus(
      "Add tests for core/orchestrator/main.ts because coverage is missing",
      "dev-agent",
      [
        report("dev-agent", ["core/orchestrator/main.ts has missing tests"]),
        report("qa-agent", ["Test coverage gap in core/orchestrator/main.ts"]),
        report("architecture-agent", ["Architecture risk and missing tests in core/orchestrator/main.ts"])
      ]
    );

    expect(consensus.confidenceMethod).toBe("structural");
    expect(consensus.consensusState).toBe("strong");
    expect(consensus.supportingAgents).toEqual(["architecture-agent", "qa-agent"]);
    expect(consensus.evidenceRefs).toEqual(["core/orchestrator/main.ts"]);
  });

  it("does not reach structural consensus with only one corroborating agent", () => {
    const consensus = structuralConsensus(
      "Add tests for core/orchestrator/main.ts because coverage is missing",
      "dev-agent",
      [
        report("dev-agent", ["core/orchestrator/main.ts has missing tests"]),
        report("qa-agent", ["Test coverage gap in core/orchestrator/main.ts"])
      ]
    );

    expect(consensus.confidenceMethod).toBe("structural");
    expect(consensus.consensusState).toBe("weak");
    expect(consensus.supportingAgents).toEqual(["qa-agent"]);
  });
});
