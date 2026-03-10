import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

import { fileExists, relativeTo, toPosixPath, uniqueSorted } from "../../shared/fs-utils";
import type { RepositoryTarget } from "../../shared/types";

const REPO_MARKERS = new Set([
  ".git",
  "package.json",
  "requirements.txt",
  "go.mod",
  "pom.xml",
  "Cargo.toml",
  "Gemfile",
  "composer.json"
]);

const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "build",
  ".next",
  ".nuxt",
  ".turbo",
  ".idea",
  ".vscode",
  "sample-output",
  "AI_CONTEXT",
  "reports",
  "docs",
  "memory",
  "tasks",
  "ecosystem"
]);

async function hasCsprojFile(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.some((entry) => entry.endsWith(".csproj"));
  } catch {
    return false;
  }
}

async function isRepositoryRoot(targetPath: string): Promise<boolean> {
  const markerChecks = await Promise.all(
    [...REPO_MARKERS].map(async (marker) => fileExists(path.join(targetPath, marker)))
  );

  if (markerChecks.some(Boolean)) {
    return true;
  }

  return hasCsprojFile(targetPath);
}

function outputExclusionName(rootPath: string, outputPath: string): string | undefined {
  const relativeOutput = relativeTo(rootPath, outputPath);

  if (!relativeOutput || relativeOutput === "." || relativeOutput.startsWith("../")) {
    return undefined;
  }

  return relativeOutput.split("/")[0];
}

export async function discoverRepositoryTargets(
  rootPath: string,
  outputPath = rootPath
): Promise<{
  mode: "single" | "workspace";
  repositories: RepositoryTarget[];
}> {
  if (await isRepositoryRoot(rootPath)) {
    return {
      mode: "single",
      repositories: [
        {
          repoName: path.basename(rootPath),
          targetPath: rootPath,
          relativePath: "."
        }
      ]
    };
  }

  let entries: Dirent[] = [];

  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return {
      mode: "single",
      repositories: [
        {
          repoName: path.basename(rootPath),
          targetPath: rootPath,
          relativePath: "."
        }
      ]
    };
  }

  const excludedName = outputExclusionName(rootPath, outputPath);
  const repositoryTargets = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .filter((entry) => !IGNORED_WORKSPACE_DIRECTORIES.has(entry.name))
        .filter((entry) => entry.name !== excludedName)
        .map(async (entry) => {
          const targetPath = path.join(rootPath, entry.name);

          if (!(await isRepositoryRoot(targetPath))) {
            return undefined;
          }

          return {
            repoName: entry.name,
            targetPath,
            relativePath: toPosixPath(entry.name)
          } satisfies RepositoryTarget;
        })
    )
  ).filter(Boolean) as RepositoryTarget[];

  if (repositoryTargets.length === 0) {
    return {
      mode: "single",
      repositories: [
        {
          repoName: path.basename(rootPath),
          targetPath: rootPath,
          relativePath: "."
        }
      ]
    };
  }

  if (repositoryTargets.length === 1) {
    return {
      mode: "workspace",
      repositories: repositoryTargets
    };
  }

  return {
    mode: "workspace",
    repositories: repositoryTargets.sort((left, right) => left.repoName.localeCompare(right.repoName))
  };
}

export function uniqueRepositoryNames(repositories: RepositoryTarget[]): string[] {
  return uniqueSorted(repositories.map((repository) => repository.repoName));
}
