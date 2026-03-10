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
  ".idea",
  ".vscode",
  ".venv",
  "venv",
  "vendor"
]);

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

export async function walkDirectory(rootPath: string, maxFiles = 8000, excludedPaths: string[] = []): Promise<string[]> {
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

      if (isExcluded) {
        continue;
      }

      if (entry.isDirectory()) {
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
