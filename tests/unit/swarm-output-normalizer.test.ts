import { describe, expect, it } from "vitest";

import {
  buildFallbackPlan,
  normalizePlannerPayload,
  normalizeSynthesisPayload,
  normalizeWorkerPayload,
  uniqueStrings
} from "../../core/swarm_runtime/output_normalizer";
import type { SwarmPlanTask } from "../../shared/types";

const task: SwarmPlanTask = {
  taskId: "scan",
  title: "Scan repository",
  goal: "Inspect the repo.",
  profile: "worker",
  deliverable: "Findings"
};

describe("swarm output normalizer", () => {
  it("falls back to deterministic planner tasks when planner output is invalid", () => {
    const plan = normalizePlannerPayload("not json", "mejora el repo");

    expect(plan.overview).toContain("mejora el repo");
    expect(plan.tasks.map((entry) => entry.taskId)).toEqual(["scan-scope", "review-risks", "reason-next-steps"]);
    expect(plan.tasks[1]?.dependsOn).toEqual(["scan-scope"]);
    expect(buildFallbackPlan("x").tasks).toHaveLength(3);
  });

  it("normalizes planner tasks and removes invalid dependencies", () => {
    const plan = normalizePlannerPayload(
      JSON.stringify({
        overview: "Custom plan",
        tasks: [
          {
            taskId: "scan",
            title: "Scan",
            goal: "Scan scope",
            profile: "worker",
            deliverable: "Scan output",
            dependsOn: ["scan", "missing"]
          },
          {
            taskId: "review",
            title: "Review",
            goal: "Review scope",
            profile: "reviewer",
            deliverable: "Review output",
            depends_on: ["scan", "scan"]
          }
        ]
      }),
      "intent"
    );

    expect(plan.overview).toBe("Custom plan");
    expect(plan.tasks[0]?.dependsOn).toBeUndefined();
    expect(plan.tasks[1]?.dependsOn).toEqual(["scan"]);
  });

  it("salvages markdown worker sections", () => {
    const payload = normalizeWorkerPayload(
      [
        "Summary: Useful local output.",
        "Findings:",
        "- Finding A",
        "Verified facts:",
        "- Fact A",
        "Evidence refs:",
        "- core/file.ts",
        "Recommendations:",
        "- Recommendation A"
      ].join("\n"),
      task
    );

    expect(payload.summary).toBe("Useful local output.");
    expect(payload.findings).toEqual(["Finding A"]);
    expect(payload.verifiedFacts).toEqual(["Fact A"]);
    expect(payload.evidenceRefs).toEqual(["core/file.ts"]);
    expect(payload.recommendations).toEqual(["Recommendation A"]);
  });

  it("quarantines code-only worker output as unknown", () => {
    const payload = normalizeWorkerPayload(
      [
        "import os",
        "from pathlib import Path",
        "def walk_repo(root):",
        "    for path in Path(root).rglob('*.ts'):",
        "        print(path)",
        "if __name__ == '__main__':",
        "    walk_repo('.')"
      ].join("\n"),
      task
    );

    expect(payload.findings).toEqual([]);
    expect(payload.summary).toContain("returned code instead of structured analysis");
    expect(payload.unknowns).toContain("Worker response looked like generated code/script instead of evidence-backed analysis.");
  });

  it("normalizes synthesis markdown and shared unique string handling", () => {
    const payload = normalizeSynthesisPayload(
      [
        "Headline: Synthesis complete",
        "Summary: Merged worker outputs.",
        "Priorities:",
        "- Priority A",
        "Next steps:",
        "- Step A",
        "Unknowns:",
        "- Unknown A"
      ].join("\n"),
      "intent"
    );

    expect(payload.headline).toBe("Synthesis complete");
    expect(payload.priorities).toEqual(["Priority A"]);
    expect(payload.next_steps).toEqual(["Step A"]);
    expect(payload.unknowns).toEqual(["Unknown A"]);
    expect(uniqueStrings(["a", "a", "", "b"])).toEqual(["a", "b"]);
  });
});
