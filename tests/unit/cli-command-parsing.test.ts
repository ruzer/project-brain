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
    expect(helpText).toContain("map-codebase");
    expect(helpText).toContain("analyze");
    expect(helpText).toContain("agents");
    expect(helpText).toContain("weekly");
    expect(helpText).toContain("code-graph");
    expect(helpText).toContain("impact-radius");
    expect(helpText).toContain("review-delta");
    expect(helpText).toContain("ask");
    expect(helpText).toContain("swarm");
    expect(helpText).toContain("self-improve");
    expect(helpText).toContain("plan-improvements");
    expect(helpText).toContain("context-search");
    expect(helpText).toContain("context-get");
    expect(helpText).toContain("context-sources");
    expect(helpText).toContain("firewall");
    expect(helpText).toContain("report");
    expect(helpText).toContain("annotate");
    expect(helpText).toContain("feedback");
    expect(helpText).toContain("models");
    expect(helpText).toContain("doctor");
    expect(helpText).toContain("status");
    expect(helpText).toContain("resume");
  });

  it("shows trigger support on analyze", () => {
    const analyzeHelp = runCliHelp(["analyze", "--help"]);

    expect(analyzeHelp).toContain("--trigger");
    expect(analyzeHelp).toContain("--ollama-timeout");
    expect(analyzeHelp).toContain("--output");
    expect(analyzeHelp).toContain("--verbose");
  });

  it("shows output support on map-codebase", () => {
    const mapHelp = runCliHelp(["map-codebase", "--help"]);

    expect(mapHelp).toContain("--output");
    expect(mapHelp).toContain("--verbose");
  });

  it("shows annotation options", () => {
    const annotateHelp = runCliHelp(["annotate", "--help"]);

    expect(annotateHelp).toContain("--scope");
    expect(annotateHelp).toContain("--list");
    expect(annotateHelp).toContain("--clear");
    expect(annotateHelp).toContain("--output");
  });

  it("shows impact analysis options", () => {
    const impactHelp = runCliHelp(["impact-radius", "--help"]);

    expect(impactHelp).toContain("--files");
    expect(impactHelp).toContain("--base");
    expect(impactHelp).toContain("--head");
    expect(impactHelp).toContain("--output");
  });

  it("shows code graph options", () => {
    const graphHelp = runCliHelp(["code-graph", "--help"]);

    expect(graphHelp).toContain("--output");
  });

  it("shows review delta options", () => {
    const reviewHelp = runCliHelp(["review-delta", "--help"]);

    expect(reviewHelp).toContain("--base");
    expect(reviewHelp).toContain("--head");
    expect(reviewHelp).toContain("--output");
  });

  it("shows ask options", () => {
    const askHelp = runCliHelp(["ask", "--help"]);

    expect(askHelp).toContain("Plain-language request");
    expect(askHelp).toContain("--output");
  });

  it("shows swarm options", () => {
    const swarmHelp = runCliHelp(["swarm", "--help"]);

    expect(swarmHelp).toContain("Delegated analysis request");
    expect(swarmHelp).toContain("--output");
    expect(swarmHelp).toContain("--parallel");
    expect(swarmHelp).toContain("--chunk-size");
    expect(swarmHelp).toContain("--task-timeout-ms");
    expect(swarmHelp).toContain("--planner-timeout-ms");
    expect(swarmHelp).toContain("--synthesis-timeout-ms");
    expect(swarmHelp).toContain("--run-timeout-ms");
    expect(swarmHelp).toContain("--max-queued-tasks");
    expect(swarmHelp).toContain("--max-retries");
  });

  it("shows self-improve options", () => {
    const selfImproveHelp = runCliHelp(["self-improve", "--help"]);

    expect(selfImproveHelp).toContain("bounded swarm");
    expect(selfImproveHelp).toContain("--output");
    expect(selfImproveHelp).toContain("--intent");
  });

  it("shows context registry options", () => {
    const searchHelp = runCliHelp(["context-search", "--help"]);
    const getHelp = runCliHelp(["context-get", "--help"]);
    const sourcesHelp = runCliHelp(["context-sources", "--help"]);

    expect(searchHelp).toContain("--trust");
    expect(searchHelp).toContain("--output");
    expect(getHelp).toContain("--output");
    expect(sourcesHelp).toContain("--output");
  });

  it("shows plan-improvements options", () => {
    const planHelp = runCliHelp(["plan-improvements", "--help"]);

    expect(planHelp).toContain("--trigger");
    expect(planHelp).toContain("--output");
  });

  it("shows firewall options", () => {
    const firewallHelp = runCliHelp(["firewall", "--help"]);

    expect(firewallHelp).toContain("--trigger");
    expect(firewallHelp).toContain("--output");
  });

  it("shows model inventory without breaking the CLI", () => {
    const result = runCli(["models"]);

    expect(result.stdout).toContain("Ollama models available:");
    expect(result.stdout).toContain("Cloud model configured:");
    expect(result.stdout).toContain("Configured local model:");
    expect(result.stdout).toContain("Routing rules:");
    expect(result.stdout).toContain("Model profiles:");
  });

  it("shows doctor options", () => {
    const doctorHelp = runCliHelp(["doctor", "--help"]);

    expect(doctorHelp).toContain("environment");
    expect(doctorHelp).toContain("--output");
  });

  it("shows status options", () => {
    const statusHelp = runCliHelp(["status", "--help"]);

    expect(statusHelp).toContain("operational status");
    expect(statusHelp).toContain("--output");
  });

  it("shows resume options", () => {
    const resumeHelp = runCliHelp(["resume", "--help"]);

    expect(resumeHelp).toContain("resume from");
    expect(resumeHelp).toContain("--output");
  });
});
