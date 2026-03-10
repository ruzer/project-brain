import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { toPosixPath, uniqueSorted } from "../../shared/fs-utils";
import type { DevArchitectureAnalysis } from "./contracts";
import { isSourceFile } from "./contracts";
import type { DependencyCruiserOutput, EslintFileResult } from "./contracts";

function findProjectBrainRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, "package.json");

    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (parsed.name === "project-brain") {
          return current;
        }
      } catch {
        // Keep walking until the package root is found.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function packageToolPath(packageRoot: string, segments: string[]): string {
  return path.join(packageRoot, ...segments);
}

function safeRunBinary(
  executable: string,
  args: string[],
  cwd: string
): { ok: true; stdout: string } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      stdout: execFileSync(executable, args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024
      })
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function resolveProjectBrainRoot(startDir: string): string {
  return findProjectBrainRoot(startDir);
}

export function runDependencyCruiser(
  packageRoot: string,
  targetPath: string,
  sourceFiles: string[]
): { output?: DependencyCruiserOutput; error?: string } {
  const depCruiseBin = packageToolPath(packageRoot, ["node_modules", "dependency-cruiser", "bin", "dependency-cruise.mjs"]);
  const topLevelTargets = uniqueSorted(sourceFiles.map((filePath) => filePath.split("/")[0]));

  if (!existsSync(depCruiseBin)) {
    return { error: "dependency-cruiser binary is not available." };
  }

  const result = safeRunBinary(process.execPath, [depCruiseBin, "--no-config", "--output-type", "json", ...topLevelTargets], targetPath);
  if (!result.ok) {
    return { error: result.error };
  }

  try {
    return { output: JSON.parse(result.stdout) as DependencyCruiserOutput };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function runTsPrune(
  packageRoot: string,
  targetPath: string
): { unusedExports: Array<{ filePath: string; symbol: string }>; error?: string } {
  const tsPruneBin = packageToolPath(packageRoot, ["node_modules", "ts-prune", "lib", "index.js"]);

  if (!existsSync(tsPruneBin)) {
    return {
      unusedExports: [],
      error: "ts-prune binary is not available."
    };
  }

  const result = safeRunBinary(process.execPath, [tsPruneBin], targetPath);
  if (!result.ok) {
    return {
      unusedExports: [],
      error: result.error
    };
  }

  const unusedExports = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?):\d+\s+-\s+(.+)$/);
      if (!match) {
        return undefined;
      }

      return {
        filePath: toPosixPath(match[1]),
        symbol: match[2].trim()
      };
    })
    .filter(Boolean) as Array<{ filePath: string; symbol: string }>;

  return { unusedExports };
}

export function runEslint(
  packageRoot: string,
  targetPath: string,
  sourceFiles: string[]
): DevArchitectureAnalysis["eslintSummary"] {
  const eslintBin = packageToolPath(packageRoot, ["node_modules", "eslint", "bin", "eslint.js"]);
  const eslintConfig = path.join(packageRoot, ".eslint.devagent.config.mjs");
  const absoluteFiles = sourceFiles.map((filePath) => path.join(targetPath, filePath));

  if (!existsSync(eslintBin) || !existsSync(eslintConfig) || absoluteFiles.length === 0) {
    return {
      checked: false,
      oversizedFiles: [],
      complexityWarnings: [],
      error: "ESLint or its DevAgent config is not available."
    };
  }

  const result = safeRunBinary(process.execPath, [eslintBin, "--config", eslintConfig, "--format", "json", ...absoluteFiles], packageRoot);
  if (!result.ok) {
    return {
      checked: false,
      oversizedFiles: [],
      complexityWarnings: [],
      error: result.error
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as EslintFileResult[];
    const oversizedFiles = uniqueSorted(
      parsed
        .filter((entry) => entry.messages.some((message) => message.ruleId === "max-lines"))
        .map((entry) => toPosixPath(path.relative(targetPath, entry.filePath)))
    );
    const complexityWarnings = uniqueSorted(
      parsed
        .filter((entry) => entry.messages.some((message) => message.ruleId === "complexity"))
        .map((entry) => toPosixPath(path.relative(targetPath, entry.filePath)))
    );

    return {
      checked: true,
      oversizedFiles,
      complexityWarnings
    };
  } catch (error) {
    return {
      checked: false,
      oversizedFiles: [],
      complexityWarnings: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function readGitChangeFrequency(targetPath: string): Map<string, number> | undefined {
  const result = safeRunBinary("git", ["-C", targetPath, "log", "-n", "150", "--name-only", "--pretty=format:"], targetPath);
  if (!result.ok) {
    return undefined;
  }

  const counts = new Map<string, number>();
  for (const line of result.stdout.split(/\r?\n/)) {
    const filePath = toPosixPath(line.trim());
    if (!filePath || !isSourceFile(filePath)) {
      continue;
    }
    counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
  }

  return counts;
}
