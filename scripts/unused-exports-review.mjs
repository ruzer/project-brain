#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = path.resolve(process.cwd(), process.argv[2] ?? ".tmp/unused-exports-review.md");

function runTsPrune() {
  try {
    return execFileSync("npx", ["ts-prune"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (stdout.trim()) {
      return stdout;
    }
    throw new Error(stderr.trim() || error.message);
  }
}

function parseLine(line) {
  const match = line.match(/^(.+?):(\d+)\s+-\s+(.+?)(?:\s+\((.+)\))?$/);
  if (!match) {
    return undefined;
  }

  return {
    filePath: match[1],
    line: Number(match[2]),
    symbol: match[3],
    note: match[4] ?? ""
  };
}

function categoryFor(entry) {
  if (entry.note === "used in module") {
    return "Internal type/export used in defining module";
  }
  if (/^(shared\/types|shared\/logger|core\/workflow_registry|core\/swarm_runtime|core\/ai_router)/.test(entry.filePath)) {
    return "Likely public API or cross-module contract";
  }
  if (/^(orchestrator|governance)\//.test(entry.filePath)) {
    return "Review candidate: orchestrator/governance";
  }
  return "Review candidate";
}

function render(entries) {
  const generatedAt = new Date().toISOString();
  const groups = entries.reduce((accumulator, entry) => {
    const category = categoryFor(entry);
    const current = accumulator.get(category) ?? [];
    current.push(entry);
    accumulator.set(category, current);
    return accumulator;
  }, new Map());

  return `# Unused Exports Review

- Generated: ${generatedAt}
- Source: \`npx ts-prune\`
- Total entries: ${entries.length}

This report is review-only. Do not delete exports in bulk: entries marked as used in module, shared contracts, or CLI-facing APIs can be intentional public surface.

${[...groups.entries()]
  .map(
    ([category, items]) => `## ${category}

${items.map((item) => `- ${item.filePath}:${item.line} - ${item.symbol}${item.note ? ` (${item.note})` : ""}`).join("\n") || "- None"}`
  )
  .join("\n\n")}
`;
}

const entries = runTsPrune()
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map(parseLine)
  .filter(Boolean);

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, render(entries), "utf8");
console.log(`Unused exports review: ${outputPath}`);
console.log(`Entries: ${entries.length}`);
