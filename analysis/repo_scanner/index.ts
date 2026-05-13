import path from "node:path";

import { readTextSafe, uniqueSorted, walkDirectory } from "../../shared/fs-utils";
import type { BasicRepoScan } from "../../shared/types";

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".py", "Python"],
  [".go", "Go"],
  [".java", "Java"],
  [".rs", "Rust"],
  [".cs", "C#"],
  [".rb", "Ruby"],
  [".php", "PHP"]
]);

function isManifestFile(file: string): boolean {
  const base = path.posix.basename(file);
  return (
    [
      "package.json",
      "requirements.txt",
      "go.mod",
      "pom.xml",
      "Cargo.toml",
      "Gemfile",
      "composer.json"
    ].includes(base) || base.endsWith(".csproj")
  );
}

function isSourceFile(file: string): boolean {
  return [...LANGUAGE_BY_EXTENSION.keys()].some((extension) => file.endsWith(extension));
}

function isTestFile(file: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i.test(file);
}

function languageSortKey(counts: Map<string, number>, language: string): string {
  return `${String(100000 - (counts.get(language) ?? 0)).padStart(6, "0")}::${language}`;
}

async function packageUsesTypeScript(targetPath: string): Promise<boolean> {
  const content = await readTextSafe(path.join(targetPath, "package.json"));
  if (!content.trim()) {
    return false;
  }

  try {
    const manifest = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {})
    };
    return Boolean(dependencies.typescript || dependencies["ts-node"]);
  } catch {
    return false;
  }
}

async function readSubmodules(targetPath: string): Promise<string[]> {
  const content = await readTextSafe(path.join(targetPath, ".gitmodules"));
  return uniqueSorted(
    [...content.matchAll(/path\s*=\s*(.+)/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[]
  );
}

export async function scanRepositoryStructure(targetPath: string, excludedPaths: string[] = []): Promise<BasicRepoScan> {
  const files = await walkDirectory(targetPath, 8000, excludedPaths);
  const languageCounts = new Map<string, number>();
  const hasPackageJson = files.some((file) => path.posix.basename(file) === "package.json");

  for (const file of files) {
    const extension = path.posix.extname(file);
    const language = LANGUAGE_BY_EXTENSION.get(extension);

    if (language) {
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1);
    }

    const base = path.posix.basename(file);
    if (base === "requirements.txt") {
      languageCounts.set("Python", Math.max(languageCounts.get("Python") ?? 0, 1));
    }
    if (base === "go.mod") {
      languageCounts.set("Go", Math.max(languageCounts.get("Go") ?? 0, 1));
    }
    if (base === "pom.xml") {
      languageCounts.set("Java", Math.max(languageCounts.get("Java") ?? 0, 1));
    }
    if (base === "Cargo.toml") {
      languageCounts.set("Rust", Math.max(languageCounts.get("Rust") ?? 0, 1));
    }
  }

  const hasTypeScriptFiles = files.some((file) => /\.(ts|tsx)$/.test(file));
  if (hasPackageJson && (hasTypeScriptFiles || await packageUsesTypeScript(targetPath))) {
    languageCounts.set("TypeScript", Math.max(languageCounts.get("TypeScript") ?? 0, 1));
  }

  const languages = [...languageCounts.keys()].sort((left, right) =>
    languageSortKey(languageCounts, left).localeCompare(languageSortKey(languageCounts, right))
  );

  const manifests = files.filter(isManifestFile);
  const subrepos = uniqueSorted(manifests.map((manifest) => path.posix.dirname(manifest)).filter((dir) => dir !== "."));
  const submodules = await readSubmodules(targetPath);

  return {
    repoName: path.basename(targetPath),
    targetPath,
    scannedAt: new Date().toISOString(),
    files,
    languages,
    ecosystem: hasPackageJson ? "node" : undefined,
    structure: {
      topLevelDirectories: uniqueSorted(
        files.map((file) => file.split("/")[0]).filter((entry) => entry && entry !== ".")
      ),
      sampleFiles: files.slice(0, 50),
      subrepos,
      submodules,
      fileCount: files.length,
      sourceFileCount: files.filter(isSourceFile).length,
      testFileCount: files.filter(isTestFile).length
    }
  };
}
