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

describe("CLI command parsing", () => {
  it("exposes the expected command surface", () => {
    const helpText = runCliHelp(["--help"]);

    expect(helpText).toContain("init");
    expect(helpText).toContain("analyze");
    expect(helpText).toContain("agents");
    expect(helpText).toContain("weekly");
    expect(helpText).toContain("report");
    expect(helpText).toContain("feedback");
  });

  it("shows trigger support on analyze", () => {
    const analyzeHelp = runCliHelp(["analyze", "--help"]);

    expect(analyzeHelp).toContain("--trigger");
    expect(analyzeHelp).toContain("--output");
    expect(analyzeHelp).toContain("--verbose");
  });
});
