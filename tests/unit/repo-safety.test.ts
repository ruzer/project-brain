import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(currentDir, "..", "..", "scripts", "check-repo-safety.mjs");

async function initRepo(repoDir) {
  execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "codex@example.com"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Codex"], { cwd: repoDir, stdio: "pipe" });
}

function runRepoSafety(repoDir) {
  execFileSync(process.execPath, [scriptPath, "--all"], {
    cwd: repoDir,
    encoding: "utf8",
    stdio: "pipe"
  });
}

describe("repo safety script", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("fails when tracked content contains an absolute local filesystem path", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "repo-safety-abs-path-"));
    cleanupTargets.push(repoDir);
    await initRepo(repoDir);

    const absolutePath = ["/Users", "alice", "private-client", "offers"].join("/");
    await writeFile(path.join(repoDir, "notes.md"), `Path: ${absolutePath}\n`, "utf8");
    execFileSync("git", ["add", "notes.md"], { cwd: repoDir, stdio: "pipe" });

    expect(() => runRepoSafety(repoDir)).toThrow(/absolute local filesystem path/i);
  });

  it("fails when local private patterns match tracked content", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "repo-safety-private-pattern-"));
    cleanupTargets.push(repoDir);
    await initRepo(repoDir);

    await mkdir(path.join(repoDir, ".project-brain-local"), { recursive: true });
    await writeFile(
      path.join(repoDir, ".project-brain-local", "private-patterns.txt"),
      "# one pattern per line\nprivate-client\n",
      "utf8"
    );
    await writeFile(path.join(repoDir, "notes.md"), "Roadmap for Private-Client launch\n", "utf8");
    execFileSync("git", ["add", "notes.md"], { cwd: repoDir, stdio: "pipe" });

    expect(() => runRepoSafety(repoDir)).toThrow(/private pattern \(private-client\)/i);
  });
});
