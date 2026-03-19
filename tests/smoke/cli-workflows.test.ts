import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupDir, createTempOutputDir, fixtureRepoPath, workspaceFixturePath } from "../helpers";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function runCli(args: string[], cwd: string): { stdout: string; stderr: string } {
  const tsNodeBin = require.resolve("ts-node/dist/bin.js");
  const cliPath = path.resolve(cwd, "cli", "project-brain.ts");
  const result = spawnSync(process.execPath, [tsNodeBin, "--transpile-only", cliPath, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      OLLAMA_TIMEOUT_MS: "1"
    }
  });

  expect(result.status).toBe(0);
  return {
    stdout: result.stdout,
    stderr: result.stderr
  };
}

describe("CLI smoke workflows", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("runs analyze, weekly, and report and validates AI_CONTEXT, reports, and docs output", async () => {
    const outputDir = await createTempOutputDir("project-brain-smoke");
    cleanupTargets.push(outputDir);
    const cwd = path.resolve(currentDir, "..", "..");

    runCli(["analyze", fixtureRepoPath, "--output", outputDir, "--trigger", "repository-change"], cwd);
    runCli(["weekly", fixtureRepoPath, "--output", outputDir], cwd);
    const reportOutput = runCli(["report", outputDir], cwd);
    const manifest = JSON.parse(reportOutput.stdout) as {
      memoryFiles: string[];
      reportFiles: string[];
      docFiles: string[];
      proposalFiles: string[];
    };

    expect(existsSync(path.join(outputDir, "AI_CONTEXT"))).toBe(true);
    expect(existsSync(path.join(outputDir, "reports"))).toBe(true);
    expect(existsSync(path.join(outputDir, "docs"))).toBe(true);
    expect(existsSync(path.join(outputDir, "docs", "proposals"))).toBe(true);
    expect(existsSync(path.join(outputDir, "reports", "telemetry"))).toBe(true);
    expect(manifest.memoryFiles.length).toBeGreaterThan(0);
    expect(manifest.reportFiles).toContain("reports/weekly_system_report.md");
    expect(manifest.reportFiles).toContain("reports/improvement_proposals.md");
    expect(manifest.reportFiles).toContain("reports/runtime_observability.md");
    expect(manifest.reportFiles.some((file) => file.startsWith("reports/telemetry/cycle_"))).toBe(true);
    expect(manifest.docFiles).toContain("docs/runbook.md");
    expect(manifest.proposalFiles.some((file) => file.startsWith("docs/proposals/proposal_"))).toBe(true);
  }, 15000);

  it("prints structured JSON logs in verbose mode while preserving telemetry output", async () => {
    const outputDir = await createTempOutputDir("project-brain-verbose");
    cleanupTargets.push(outputDir);
    const cwd = path.resolve(currentDir, "..", "..");

    const result = runCli(
      ["analyze", fixtureRepoPath, "--output", outputDir, "--trigger", "architecture-review", "--verbose"],
      cwd
    );
    const logLine = result.stderr
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("{"));

    expect(logLine).toBeDefined();

    const payload = JSON.parse(logLine ?? "{}") as {
      timestamp?: string;
      component?: string;
      action?: string;
      message?: string;
      cycleId?: string | null;
    };

    expect(payload.timestamp).toBeTruthy();
    expect(payload.component).toBeTruthy();
    expect(payload.action).toBeTruthy();
    expect(payload.message).toBeTruthy();
    expect(payload.cycleId === null || typeof payload.cycleId === "string").toBe(true);
    expect(existsSync(path.join(outputDir, "reports", "runtime_observability.md"))).toBe(true);
    expect(existsSync(path.join(outputDir, "reports", "telemetry"))).toBe(true);
  }, 10000);

  it("analyzes a workspace and writes ecosystem-level artifacts", async () => {
    const outputDir = await createTempOutputDir("project-brain-workspace-smoke");
    cleanupTargets.push(outputDir);
    const cwd = path.resolve(currentDir, "..", "..");

    const result = runCli(["analyze", workspaceFixturePath, "--output", outputDir, "--trigger", "repository-change"], cwd);

    expect(result.stdout).toContain("Analyzed ecosystem");
    expect(result.stdout).toContain("CashCalculator, ERP, OffRoadHub, project-brain");
    expect(existsSync(path.join(outputDir, "memory", "knowledge_graph", "knowledge_graph.json"))).toBe(true);
    expect(existsSync(path.join(outputDir, "reports", "ecosystem_health.md"))).toBe(true);
    expect(existsSync(path.join(outputDir, "reports", "telemetry"))).toBe(true);
    expect(existsSync(path.join(outputDir, "docs", "proposals"))).toBe(true);
  }, 15000);

  it("preserves the dedicated security-advisory trigger through the CLI firewall flow", async () => {
    const outputDir = await createTempOutputDir("project-brain-advisory-smoke");
    cleanupTargets.push(outputDir);
    const cwd = path.resolve(currentDir, "..", "..");

    runCli(["firewall", fixtureRepoPath, "--output", outputDir, "--trigger", "security-advisory"], cwd);

    const firewallReport = readFileSync(path.join(outputDir, "reports", "agent_firewall.md"), "utf8");

    expect(firewallReport).toContain("Trigger: security-advisory");
  }, 10000);
});
