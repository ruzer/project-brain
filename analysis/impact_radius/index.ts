import path from "node:path";

import { buildOrUpdateCodeGraphV2, supportsCodeGraphV2 } from "../code_graph_v2";
import { readTextSafe, toPosixPath, uniqueSorted, writeFileEnsured, writeJsonEnsured, walkDirectory } from "../../shared/fs-utils";
import type { CodeGraphDocument, ImpactAnalysisResult, ProjectContext } from "../../shared/types";
import { listChangedFiles } from "../../tools/git_tools";

interface LegacyImportGraphDocument {
  generatedAt: string;
  targetPath: string;
  nodes: string[];
  edges: Array<{
    from: string;
    to: string;
  }>;
  unresolvedImports: Array<{
    file: string;
    specifier: string;
  }>;
}

const LEGACY_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py"];

function isLegacySource(filePath: string): boolean {
  return LEGACY_SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i.test(filePath) || /\.(test|spec)\.[^.]+$/i.test(filePath);
}

function normalizeFiles(files: string[]): string[] {
  return uniqueSorted(files.map((filePath) => toPosixPath(filePath).replace(/^\.\/+/, "")));
}

function parseJavaScriptImports(content: string): string[] {
  const matches = [
    ...content.matchAll(/\bimport\s+[^"']*?from\s+["']([^"']+)["']/g),
    ...content.matchAll(/\bexport\s+[^"']*?from\s+["']([^"']+)["']/g),
    ...content.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g),
    ...content.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)
  ];

  return uniqueSorted(
    matches
      .map((match) => match[1]?.trim())
      .filter(Boolean) as string[]
  );
}

function parsePythonImports(content: string): string[] {
  const matches = [
    ...content.matchAll(/^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/gm),
    ...content.matchAll(/^\s*from\s+(\.+[A-Za-z0-9_\.]*)\s+import\s+/gm),
    ...content.matchAll(/^\s*import\s+([A-Za-z0-9_\.]+)/gm)
  ];

  return uniqueSorted(
    matches
      .map((match) => match[1]?.trim())
      .filter(Boolean) as string[]
  );
}

function resolveRelativeImport(
  fromFile: string,
  specifier: string,
  knownFiles: Set<string>
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const baseDir = path.posix.dirname(fromFile);
  const resolvedBase = path.posix.normalize(path.posix.join(baseDir, specifier));
  const candidates = new Set<string>([resolvedBase]);

  for (const extension of LEGACY_SOURCE_EXTENSIONS) {
    candidates.add(`${resolvedBase}${extension}`);
    candidates.add(path.posix.join(resolvedBase, `index${extension}`));
  }

  for (const candidate of candidates) {
    const normalized = toPosixPath(candidate);
    if (knownFiles.has(normalized)) {
      return normalized;
    }
  }

  return undefined;
}

function resolvePythonImport(specifier: string, fromFile: string, knownFiles: Set<string>): string | undefined {
  if (specifier.startsWith(".")) {
    const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
    const modulePath = specifier.slice(dots).replace(/\./g, "/");
    let baseDir = path.posix.dirname(fromFile);

    for (let index = 1; index < dots; index += 1) {
      baseDir = path.posix.dirname(baseDir);
    }

    const resolved = path.posix.join(baseDir, modulePath);
    const candidates = [`${resolved}.py`, path.posix.join(resolved, "__init__.py")];

    return candidates.find((candidate) => knownFiles.has(candidate));
  }

  const absolutePath = specifier.replace(/\./g, "/");
  const candidates = [`${absolutePath}.py`, path.posix.join(absolutePath, "__init__.py")];
  return candidates.find((candidate) => knownFiles.has(candidate));
}

function resolveImport(
  filePath: string,
  specifier: string,
  knownFiles: Set<string>
): string | undefined {
  if (filePath.endsWith(".py")) {
    return resolvePythonImport(specifier, filePath, knownFiles);
  }

  return resolveRelativeImport(filePath, specifier, knownFiles);
}

async function buildLegacyImportGraph(
  targetPath: string,
  excludePaths: string[]
): Promise<{
  importsByFile: Map<string, string[]>;
  reverseDependencies: Map<string, string[]>;
  unresolvedImports: Array<{ file: string; specifier: string }>;
}> {
  const files = (await walkDirectory(targetPath, 12000, excludePaths)).filter(isLegacySource);
  const normalizedFiles = normalizeFiles(files);
  const knownFiles = new Set(normalizedFiles);
  const importsByFile = new Map<string, string[]>();
  const reverseDependencies = new Map<string, Set<string>>();
  const unresolvedImports: Array<{ file: string; specifier: string }> = [];

  for (const filePath of normalizedFiles) {
    const content = await readTextSafe(path.join(targetPath, filePath));
    const rawImports = filePath.endsWith(".py") ? parsePythonImports(content) : parseJavaScriptImports(content);
    const resolvedImports = uniqueSorted(
      rawImports
        .map((specifier) => {
          const resolved = resolveImport(filePath, specifier, knownFiles);
          if (!resolved && (specifier.startsWith(".") || filePath.endsWith(".py"))) {
            unresolvedImports.push({ file: filePath, specifier });
          }
          return resolved;
        })
        .filter(Boolean) as string[]
    );

    importsByFile.set(filePath, resolvedImports);

    for (const importedFile of resolvedImports) {
      const current = reverseDependencies.get(importedFile) ?? new Set<string>();
      current.add(filePath);
      reverseDependencies.set(importedFile, current);
    }
  }

  return {
    importsByFile,
    reverseDependencies: new Map(
      [...reverseDependencies.entries()].map(([filePath, dependents]) => [filePath, uniqueSorted([...dependents])])
    ),
    unresolvedImports
  };
}

function relatedTestFilesFromImports(
  importsByFile: Map<string, string[]>,
  affectedFiles: Set<string>
): string[] {
  return uniqueSorted(
    [...importsByFile.entries()]
      .filter(([filePath, imports]) => isTestFile(filePath) && imports.some((importedFile) => affectedFiles.has(importedFile)))
      .map(([filePath]) => filePath)
  );
}

function reviewSet(
  changedFiles: string[],
  directDependents: string[],
  transitiveDependents: string[],
  impactedTests: string[]
): string[] {
  return uniqueSorted([...changedFiles, ...directDependents, ...transitiveDependents, ...impactedTests]);
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function buildReverseDependenciesFromCodeGraph(graph: CodeGraphDocument): Map<string, string[]> {
  const reverse = new Map<string, Set<string>>();

  for (const file of graph.files) {
    for (const importedFile of file.imports) {
      const current = reverse.get(importedFile) ?? new Set<string>();
      current.add(file.filePath);
      reverse.set(importedFile, current);
    }
  }

  return new Map([...reverse.entries()].map(([filePath, dependents]) => [filePath, uniqueSorted([...dependents])]));
}

function relatedTestFilesFromCodeGraph(graph: CodeGraphDocument, affectedFiles: Set<string>): string[] {
  return uniqueSorted(
    graph.files
      .filter((file) => file.isTest && file.imports.some((importedFile) => affectedFiles.has(importedFile)))
      .map((file) => file.filePath)
  );
}

function computeDependents(
  changedFiles: string[],
  reverseDependencies: Map<string, string[]>
): {
  directDependents: string[];
  transitiveDependents: string[];
} {
  const directDependents = uniqueSorted(
    changedFiles
      .flatMap((filePath) => reverseDependencies.get(filePath) ?? [])
      .filter((filePath) => !isTestFile(filePath))
  );
  const visited = new Set<string>(changedFiles);
  const queue = [...directDependents];
  const transitiveDependents: string[] = [];

  for (const filePath of directDependents) {
    visited.add(filePath);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverseDependencies.get(current) ?? [];

    for (const dependent of dependents) {
      if (visited.has(dependent) || isTestFile(dependent)) {
        continue;
      }

      visited.add(dependent);
      transitiveDependents.push(dependent);
      queue.push(dependent);
    }
  }

  return {
    directDependents,
    transitiveDependents: uniqueSorted(transitiveDependents)
  };
}

function renderImpactReport(input: {
  context: ProjectContext;
  graphMode: "legacy-imports" | "code-graph-v2";
  graphBuildMode: "full" | "incremental";
  graphNodes: number;
  graphEdges: number;
  graphFiles: number;
  graphSymbols: number;
  changedFiles: string[];
  analyzableChangedFiles: string[];
  directDependents: string[];
  transitiveDependents: string[];
  impactedTests: string[];
  reviewFiles: string[];
  unresolvedImports: string[];
}): string {
  return `# Impact Radius

## Scope

- Repository: ${input.context.repoName}
- Graph engine: ${input.graphMode}
- Graph build mode: ${input.graphBuildMode}
- Changed files: ${input.changedFiles.length}
- Changed files analyzed structurally: ${input.analyzableChangedFiles.length}
- Graph files: ${input.graphFiles}
- Graph symbols: ${input.graphSymbols}
- Graph nodes: ${input.graphNodes}
- Graph edges: ${input.graphEdges}

## Changed Files

${renderList(input.changedFiles)}

## Structurally Analyzed Files

${renderList(input.analyzableChangedFiles)}

## Direct Dependents

${renderList(input.directDependents)}

## Transitive Dependents

${renderList(input.transitiveDependents)}

## Related Tests

${renderList(input.impactedTests)}

## Minimal Review Set

${renderList(input.reviewFiles)}

## Unresolved Imports

${renderList(input.unresolvedImports)}
`;
}

async function analyzeWithLegacyGraph(
  context: ProjectContext,
  changedFiles: string[]
): Promise<ImpactAnalysisResult> {
  const relativeOutput = toPosixPath(path.relative(context.targetPath, context.outputPath));
  const excludePaths =
    !relativeOutput || relativeOutput === "." || relativeOutput.startsWith("../")
      ? []
      : [relativeOutput];
  const graph = await buildLegacyImportGraph(context.targetPath, excludePaths);
  const analyzableChangedFiles = changedFiles.filter((filePath) => graph.importsByFile.has(filePath));
  const dependentInfo = computeDependents(analyzableChangedFiles, graph.reverseDependencies);
  const affectedFiles = new Set<string>([
    ...analyzableChangedFiles,
    ...dependentInfo.directDependents,
    ...dependentInfo.transitiveDependents
  ]);
  const impactedTests = uniqueSorted([
    ...changedFiles.filter(isTestFile),
    ...[...affectedFiles].filter(isTestFile),
    ...relatedTestFilesFromImports(graph.importsByFile, affectedFiles)
  ]);
  const reviewFiles = reviewSet(changedFiles, dependentInfo.directDependents, dependentInfo.transitiveDependents, impactedTests);

  const graphDir = path.join(context.runtimeMemoryDir, "code_graph");
  const reportPath = path.join(context.reportsDir, "impact_radius.md");
  const graphPath = path.join(graphDir, "import_graph.json");
  const graphDocument: LegacyImportGraphDocument = {
    generatedAt: new Date().toISOString(),
    targetPath: context.targetPath,
    nodes: uniqueSorted([...graph.importsByFile.keys()]),
    edges: uniqueSorted(
      [...graph.importsByFile.entries()].flatMap(([from, imports]) => imports.map((to) => `${from}:::${to}`))
    ).map((edge) => {
      const [from, to] = edge.split(":::");
      return { from, to };
    }),
    unresolvedImports: graph.unresolvedImports
  };
  const unresolvedImports = uniqueSorted(graph.unresolvedImports.map((entry) => `${entry.file} -> ${entry.specifier}`));
  const reportContent = renderImpactReport({
    context,
    graphMode: "legacy-imports",
    graphBuildMode: "full",
    graphNodes: graphDocument.nodes.length,
    graphEdges: graphDocument.edges.length,
    graphFiles: graphDocument.nodes.length,
    graphSymbols: 0,
    changedFiles,
    analyzableChangedFiles,
    directDependents: dependentInfo.directDependents,
    transitiveDependents: dependentInfo.transitiveDependents,
    impactedTests,
    reviewFiles,
    unresolvedImports
  });

  await writeJsonEnsured(graphPath, graphDocument);
  await writeFileEnsured(reportPath, reportContent);

  return {
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    changedFiles,
    directDependents: dependentInfo.directDependents,
    transitiveDependents: dependentInfo.transitiveDependents,
    impactedTests,
    reviewFiles,
    unresolvedImports,
    graphPath,
    reportPath,
    graphStats: {
      nodes: graphDocument.nodes.length,
      edges: graphDocument.edges.length,
      files: graphDocument.nodes.length,
      symbols: 0,
      buildMode: "full",
      updatedFiles: analyzableChangedFiles.length
    }
  };
}

async function analyzeWithCodeGraphV2(
  context: ProjectContext,
  changedFiles: string[]
): Promise<ImpactAnalysisResult> {
  const { graphPath, graph } = await buildOrUpdateCodeGraphV2(context);
  const graphFiles = new Set(graph.files.map((file) => file.filePath));
  const analyzableChangedFiles = changedFiles.filter((filePath) => graphFiles.has(filePath));
  const reverseDependencies = buildReverseDependenciesFromCodeGraph(graph);
  const dependentInfo = computeDependents(analyzableChangedFiles, reverseDependencies);
  const affectedFiles = new Set<string>([
    ...analyzableChangedFiles,
    ...dependentInfo.directDependents,
    ...dependentInfo.transitiveDependents
  ]);
  const impactedTests = uniqueSorted([
    ...changedFiles.filter((filePath) => isTestFile(filePath) || graph.files.find((file) => file.filePath === filePath)?.isTest),
    ...relatedTestFilesFromCodeGraph(graph, affectedFiles)
  ]);
  const reviewFiles = reviewSet(changedFiles, dependentInfo.directDependents, dependentInfo.transitiveDependents, impactedTests);
  const reportPath = path.join(context.reportsDir, "impact_radius.md");
  const reportContent = renderImpactReport({
    context,
    graphMode: "code-graph-v2",
    graphBuildMode: graph.build.mode,
    graphNodes: graph.stats.nodes,
    graphEdges: graph.stats.edges,
    graphFiles: graph.stats.files,
    graphSymbols: graph.stats.symbols,
    changedFiles,
    analyzableChangedFiles,
    directDependents: dependentInfo.directDependents,
    transitiveDependents: dependentInfo.transitiveDependents,
    impactedTests,
    reviewFiles,
    unresolvedImports: []
  });
  await writeFileEnsured(reportPath, reportContent);

  return {
    targetPath: context.targetPath,
    outputPath: context.outputPath,
    changedFiles,
    directDependents: dependentInfo.directDependents,
    transitiveDependents: dependentInfo.transitiveDependents,
    impactedTests,
    reviewFiles,
    unresolvedImports: [],
    graphPath,
    reportPath,
    graphStats: {
      nodes: graph.stats.nodes,
      edges: graph.stats.edges,
      files: graph.stats.files,
      symbols: graph.stats.symbols,
      buildMode: graph.build.mode,
      updatedFiles: graph.build.updatedFiles.length
    }
  };
}

export async function analyzeImpactRadius(
  context: ProjectContext,
  options?: {
    files?: string[];
    baseRef?: string;
    headRef?: string;
  }
): Promise<ImpactAnalysisResult> {
  const changedFiles =
    options?.files && options.files.length > 0
      ? normalizeFiles(options.files)
      : normalizeFiles(listChangedFiles(context.targetPath, options?.baseRef, options?.headRef));

  const shouldUseLegacy =
    changedFiles.some((filePath) => !supportsCodeGraphV2(filePath) && isLegacySource(filePath));

  if (shouldUseLegacy) {
    return analyzeWithLegacyGraph(context, changedFiles);
  }

  const v2Result = await analyzeWithCodeGraphV2(context, changedFiles);

  if (v2Result.graphStats.files === 0) {
    return analyzeWithLegacyGraph(context, changedFiles);
  }

  return v2Result;
}
