import path from "node:path";

import { readJsonSafe, readTextSafe, uniqueSorted } from "../../shared/fs-utils";
import type { DependencyManifest, DependencyScanResult } from "../../shared/types";

const FRAMEWORK_MAP = new Map<string, string>([
  ["@nestjs/core", "NestJS"],
  ["express", "Express"],
  ["next", "NextJS"],
  ["react", "React"],
  ["django", "Django"],
  ["flask", "Flask"],
  ["fastapi", "FastAPI"],
  ["spring-boot-starter", "Spring"],
  ["springframework", "Spring"],
  ["rails", "Rails"]
]);

const TESTING_MAP = new Map<string, string>([
  ["jest", "Jest"],
  ["pytest", "Pytest"],
  ["vitest", "Vitest"],
  ["mocha", "Mocha"],
  ["cypress", "Cypress"]
]);

interface PackageJsonShape {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function detectSignals(
  dependencies: string[],
  frameworks: Set<string>,
  testing: Set<string>
): void {
  for (const dependency of dependencies) {
    const lower = dependency.toLowerCase();

    for (const [needle, framework] of FRAMEWORK_MAP.entries()) {
      if (lower.includes(needle)) {
        frameworks.add(framework);
      }
    }

    for (const [needle, testFramework] of TESTING_MAP.entries()) {
      if (lower.includes(needle)) {
        testing.add(testFramework);
      }
    }
  }
}

function parseRequirements(content: string): string[] {
  return uniqueSorted(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("-r"))
      .map((line) => line.match(/^([A-Za-z0-9_.-]+)/)?.[1] ?? "")
      .filter(Boolean)
  );
}

function parseGoMod(content: string): string[] {
  return uniqueSorted(
    [...content.matchAll(/^\s*([A-Za-z0-9_.\-\/]+)\s+v[\w.+-]+/gm)]
      .map((match) => match[1])
      .filter(Boolean) as string[]
  );
}

function parsePom(content: string): string[] {
  return uniqueSorted(
    [...content.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)]
      .map((match) => match[1])
      .filter((dependency) => dependency !== "project")
  );
}

function parseCargo(content: string): string[] {
  const dependencies: string[] = [];
  let inDependencyBlock = false;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inDependencyBlock = trimmed === "[dependencies]" || trimmed === "[dev-dependencies]";
      continue;
    }

    if (!inDependencyBlock || !trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (match?.[1]) {
      dependencies.push(match[1]);
    }
  }

  return uniqueSorted(dependencies);
}

function parseGemfile(content: string): string[] {
  return uniqueSorted(
    [...content.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((match) => match[1]).filter(Boolean) as string[]
  );
}

async function parseManifest(rootPath: string, manifest: string): Promise<DependencyManifest> {
  const absolutePath = path.join(rootPath, manifest);
  const base = path.posix.basename(manifest);

  if (base === "package.json") {
    const parsed = (await readJsonSafe<PackageJsonShape>(absolutePath)) ?? {};
    const dependencies = uniqueSorted([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
      ...Object.keys(parsed.optionalDependencies ?? {})
    ]);
    return { path: manifest, ecosystem: "node", dependencies };
  }

  const content = await readTextSafe(absolutePath);

  if (base === "requirements.txt") {
    return { path: manifest, ecosystem: "python", dependencies: parseRequirements(content) };
  }

  if (base === "go.mod") {
    return { path: manifest, ecosystem: "go", dependencies: parseGoMod(content) };
  }

  if (base === "pom.xml") {
    return { path: manifest, ecosystem: "java", dependencies: parsePom(content) };
  }

  if (base === "Cargo.toml") {
    return { path: manifest, ecosystem: "rust", dependencies: parseCargo(content) };
  }

  if (base === "Gemfile") {
    return { path: manifest, ecosystem: "ruby", dependencies: parseGemfile(content) };
  }

  if (base === "composer.json") {
    const parsed = (await readJsonSafe<{ require?: Record<string, string> }>(absolutePath)) ?? {};
    return { path: manifest, ecosystem: "php", dependencies: uniqueSorted(Object.keys(parsed.require ?? {})) };
  }

  if (base.endsWith(".csproj")) {
    return {
      path: manifest,
      ecosystem: "dotnet",
      dependencies: uniqueSorted(
        [...content.matchAll(/PackageReference\s+Include="([^"]+)"/g)].map((match) => match[1]).filter(Boolean) as string[]
      )
    };
  }

  return { path: manifest, ecosystem: "unknown", dependencies: [] };
}

export async function scanDependencies(rootPath: string, files: string[]): Promise<DependencyScanResult> {
  const manifests = files.filter((file) => {
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
  });
  const dependencies = await Promise.all(manifests.map((manifest) => parseManifest(rootPath, manifest)));
  const frameworks = new Set<string>();
  const testing = new Set<string>();

  for (const manifest of dependencies) {
    detectSignals(manifest.dependencies, frameworks, testing);
  }

  return {
    manifests,
    dependencies,
    frameworks: uniqueSorted([...frameworks]),
    testing: uniqueSorted([...testing])
  };
}
