import path from "node:path";

import { readTextSafe, uniqueSorted, walkDirectory } from "../../shared/fs-utils";
import type { BasicRepoScan } from "../../shared/types";

const LANGUAGE_BY_EXTENSION = new Map<string, string>([
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
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

async function readSubmodules(targetPath: string): Promise<string[]> {
  const content = await readTextSafe(path.join(targetPath, ".gitmodules"));
  return uniqueSorted(
    [...content.matchAll(/path\s*=\s*(.+)/g)].map((match) => match[1]?.trim()).filter(Boolean) as string[]
  );
}

export async function scanRepositoryStructure(targetPath: string, excludedPaths: string[] = []): Promise<BasicRepoScan> {
  const files = await walkDirectory(targetPath, 8000, excludedPaths);
  const languages = new Set<string>();

  for (const file of files) {
    const extension = path.posix.extname(file);
    const language = LANGUAGE_BY_EXTENSION.get(extension);

    if (language) {
      languages.add(language);
    }

    const base = path.posix.basename(file);
    if (base === "package.json") {
      languages.add("TypeScript");
    }
    if (base === "requirements.txt") {
      languages.add("Python");
    }
    if (base === "go.mod") {
      languages.add("Go");
    }
    if (base === "pom.xml") {
      languages.add("Java");
    }
    if (base === "Cargo.toml") {
      languages.add("Rust");
    }
  }

  const manifests = files.filter(isManifestFile);
  const subrepos = uniqueSorted(manifests.map((manifest) => path.posix.dirname(manifest)).filter((dir) => dir !== "."));
  const submodules = await readSubmodules(targetPath);

  return {
    repoName: path.basename(targetPath),
    targetPath,
    scannedAt: new Date().toISOString(),
    files,
    languages: uniqueSorted([...languages]),
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
