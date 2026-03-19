import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

try {
  runGit(["rev-parse", "--show-toplevel"]);
} catch {
  console.log("Skipping hook installation because this directory is not a git repository.");
  process.exit(0);
}

const hooksPath = "scripts/git-hooks";
const hookFiles = ["pre-commit", "pre-push", "commit-msg"];

if (!existsSync(".git")) {
  console.log("Skipping hook installation because .git is not present.");
  process.exit(0);
}

for (const hookFile of hookFiles) {
  chmodSync(`${hooksPath}/${hookFile}`, 0o755);
}

runGit(["config", "--local", "core.hooksPath", hooksPath]);
console.log(`Configured git hooks at ${hooksPath}`);
