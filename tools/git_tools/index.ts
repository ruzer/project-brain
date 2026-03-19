import { execFileSync } from "node:child_process";
import path from "node:path";

import type { GitInfo } from "../../shared/types";

function readGit(targetPath: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", targetPath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

export function inspectGit(targetPath: string, hasSubmodules: boolean): GitInfo {
  const isGitRepo = readGit(targetPath, ["rev-parse", "--is-inside-work-tree"]) === "true";

  if (!isGitRepo) {
    return { isGitRepo: false, hasSubmodules };
  }

  return {
    isGitRepo: true,
    branch: readGit(targetPath, ["branch", "--show-current"]),
    latestCommit: readGit(targetPath, ["log", "-1", "--pretty=%h %s"]),
    hasSubmodules
  };
}

export function listChangedFiles(targetPath: string, baseRef = "HEAD~1", headRef = "HEAD"): string[] {
  const output = readGit(targetPath, ["diff", "--name-only", baseRef, headRef]);
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .map((filePath) => filePath.split(path.sep).join("/"));
}
