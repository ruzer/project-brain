import { describe, expect, it, vi, beforeEach } from "vitest";

import { cleanupDir, createTempOutputDir, devAgentFixtureRepoPath } from "../helpers";
import type { SwarmRunResult } from "../../shared/types";

const mocked = vi.hoisted(() => ({
  runSwarm: vi.fn(),
  runDeepAgentsSwarm: vi.fn()
}));

vi.mock("../../core/swarm_runtime", () => ({
  runSwarm: mocked.runSwarm
}));

vi.mock("../../core/deepagents_swarm", () => ({
  runDeepAgentsSwarm: mocked.runDeepAgentsSwarm
}));

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";

function stubSwarmResult(engine: SwarmRunResult["engine"]): SwarmRunResult {
  return { engine } as SwarmRunResult;
}

describe("swarm engine routing", () => {
  beforeEach(() => {
    mocked.runSwarm.mockReset();
    mocked.runDeepAgentsSwarm.mockReset();
    mocked.runSwarm.mockResolvedValue(stubSwarmResult("bounded"));
    mocked.runDeepAgentsSwarm.mockResolvedValue(stubSwarmResult("deepagents"));
  });

  it("uses the bounded runtime by default", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-engine-default");

    try {
      const orchestrator = new ProjectBrainOrchestrator();
      const result = await orchestrator.swarm(devAgentFixtureRepoPath, outputDir, "ayudame a mejorar este repo");

      expect(result.engine).toBe("bounded");
      expect(mocked.runSwarm).toHaveBeenCalledOnce();
      expect(mocked.runDeepAgentsSwarm).not.toHaveBeenCalled();
    } finally {
      await cleanupDir(outputDir);
    }
  });

  it("routes the deepagents engine to the experimental runtime", async () => {
    const outputDir = await createTempOutputDir("project-brain-swarm-engine-deepagents");

    try {
      const orchestrator = new ProjectBrainOrchestrator();
      const result = await orchestrator.swarm(devAgentFixtureRepoPath, outputDir, "ayudame a mejorar este repo", {
        engine: "deepagents"
      });

      expect(result.engine).toBe("deepagents");
      expect(mocked.runDeepAgentsSwarm).toHaveBeenCalledOnce();
      expect(mocked.runSwarm).not.toHaveBeenCalled();
    } finally {
      await cleanupDir(outputDir);
    }
  });
});
