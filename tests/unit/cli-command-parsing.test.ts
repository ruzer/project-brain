import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function runCliHelp(args: string[]): string {
  const cwd = path.resolve(currentDir, "..", "..");
  const tsNodeBin = require.resolve("ts-node/dist/bin.js");
  const cliPath = path.resolve(cwd, "cli", "project-brain.ts");
  const result = spawnSync(process.execPath, [tsNodeBin, "--transpile-only", cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });

  expect(result.status).toBe(0);
  return result.stdout;
}

function runCli(args: string[]): { stdout: string; stderr: string } {
  const cwd = path.resolve(currentDir, "..", "..");
  const tsNodeBin = require.resolve("ts-node/dist/bin.js");
  const cliPath = path.resolve(cwd, "cli", "project-brain.ts");
  const result = spawnSync(process.execPath, [tsNodeBin, "--transpile-only", cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });

  expect(result.status).toBe(0);
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

describe("CLI command parsing", () => {
  it("exposes the expected command surface", () => {
    const helpText = runCliHelp(["--help"]);

    expect(helpText).toContain("init");
    expect(helpText).toContain("analyze");
    expect(helpText).toContain("agents");
    expect(helpText).toContain("weekly");
    expect(helpText).toContain("report");
    expect(helpText).toContain("feedback");
    expect(helpText).toContain("models");
  });

  it("shows trigger support on analyze", () => {
    const analyzeHelp = runCliHelp(["analyze", "--help"]);

    expect(analyzeHelp).toContain("--trigger");
    expect(analyzeHelp).toContain("--ollama-timeout");
    expect(analyzeHelp).toContain("--output");
    expect(analyzeHelp).toContain("--verbose");
  });

  it("shows model inventory without breaking the CLI", () => {
    const result = runCli(["models"]);

    expect(result.stdout).toContain("Local models available:");
    expect(result.stdout).toContain("Cloud model configured:");
    expect(result.stdout).toContain("Configured local model:");
    expect(result.stdout).toContain("Routing rules:");
  });
});
