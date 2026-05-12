import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".claude",
  ".project-brain",
  ".project-brain-local",
  ".idea",
  ".vscode",
  ".venv",
  "venv"
]);

const ROOT_GENERATED_DIRECTORIES = new Set(["AI_CONTEXT", "reports", "tasks", "patch_proposals", "BRAIN"]);

const IGNORED_PATH_PATTERNS = [
  /(^|\/)__fixtures__(\/|$)/i,
  /(^|\/)(tests?|spec)\/fixtures(\/|$)/i
];

async function looksLikeProjectBrainRuntimeMemory(memoryPath: string): Promise<boolean> {
  const generatedMarkers = [
    "memory_brief/memory_brief.json",
    "executive_summary/executive_summary.json",
    "knowledge_graph/repository_fact_graph.json",
    "code_graph/code_graph_v2.json",
    "firewall/agent_firewall.json"
  ];

  const markerChecks = await Promise.all(generatedMarkers.map((marker) => fileExists(path.join(memoryPath, marker))));
  return markerChecks.some(Boolean);
}

function isDependencyVendorDirectory(relativeDir: string, entryName: string): boolean {
  if (entryName !== "vendor") {
    return false;
  }

  return relativeDir === "" || relativeDir === "core" || relativeDir === "app" || relativeDir === "default/app";
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readTextSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  const content = await readTextSafe(filePath);
  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

export async function writeFileEnsured(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function writeJsonEnsured(filePath: string, data: unknown): Promise<void> {
  await writeFileEnsured(filePath, JSON.stringify(data, null, 2));
}

export async function appendFileEnsured(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, content, "utf8");
}

export async function walkDirectory(
  rootPath: string,
  maxFiles = 8000,
  excludedPaths: string[] = [],
  options: { includeGeneratedArtifacts?: boolean } = {}
): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [""];
  const normalizedExclusions = excludedPaths.map((value) => toPosixPath(value).replace(/^\.\/+/, ""));

  while (queue.length > 0) {
    const relativeDir = queue.shift() ?? "";
    const absoluteDir = relativeDir ? path.join(rootPath, relativeDir) : rootPath;
    let entries;

    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const normalizedPath = toPosixPath(relativePath);
      const isExcluded = normalizedExclusions.some(
        (excludedPath) =>
          excludedPath !== "" &&
          (normalizedPath === excludedPath || normalizedPath.startsWith(`${excludedPath}/`))
      );
      const matchesIgnoredPattern = IGNORED_PATH_PATTERNS.some((pattern) => pattern.test(normalizedPath));

      if (isExcluded || matchesIgnoredPattern) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!options.includeGeneratedArtifacts && relativeDir === "" && ROOT_GENERATED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        if (
          !options.includeGeneratedArtifacts &&
          relativeDir === "" &&
          entry.name === "memory" &&
          (await looksLikeProjectBrainRuntimeMemory(path.join(rootPath, relativePath)))
        ) {
          continue;
        }

        if (!options.includeGeneratedArtifacts && relativeDir === "docs" && entry.name === "codebase_map") {
          continue;
        }

        if (isDependencyVendorDirectory(toPosixPath(relativeDir), entry.name)) {
          continue;
        }

        if (IGNORED_DIRECTORIES.has(entry.name)) {
          continue;
        }

        queue.push(relativePath);
        continue;
      }

      files.push(normalizedPath);

      if (files.length >= maxFiles) {
        return files.sort();
      }
    }
  }

  return files.sort();
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function relativeTo(basePath: string, targetPath: string): string {
  return toPosixPath(path.relative(basePath, targetPath) || ".");
}
