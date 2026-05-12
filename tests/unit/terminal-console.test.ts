import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDefaultTerminalSession, summarizeTerminalSession } from "../../cli/terminal-console";

describe("terminal console helpers", () => {
  it("defaults target to the working directory and output to BRAIN", () => {
    const cwd = path.resolve("/tmp/project-brain-console");
    const session = createDefaultTerminalSession(cwd);

    expect(session.targetPath).toBe(cwd);
    expect(session.outputPath).toBe(path.join(cwd, "BRAIN"));
    expect(session.trigger).toBe("manual");
    expect(session.swarmEngine).toBe("bounded");
    expect(session.verbose).toBe(false);
  });

  it("summarizes the session with runtime and swarm defaults", () => {
    const summary = summarizeTerminalSession({
      targetPath: "/repo",
      outputPath: "/output",
      trigger: "architecture-review",
      verbose: true,
      ollamaTimeoutMs: 240000,
      swarmEngine: "deepagents",
      parallelism: 3,
      chunkSize: 1,
      taskTimeoutMs: 12000,
      plannerTimeoutMs: 8000,
      synthesisTimeoutMs: 8000,
      runTimeoutMs: 30000,
      maxQueuedTasks: 8,
      maxRetries: 1
    });

    expect(summary).toContain("Target: /repo");
    expect(summary).toContain("Output: /output");
    expect(summary).toContain("Trigger: architecture-review");
    expect(summary).toContain("Verbose logs: on");
    expect(summary).toContain("Ollama timeout: 240000");
    expect(summary.some((line) => line.includes("engine=deepagents"))).toBe(true);
    expect(summary.some((line) => line.includes("parallel=3"))).toBe(true);
    expect(summary.some((line) => line.includes("maxRetries=1"))).toBe(true);
  });
});
