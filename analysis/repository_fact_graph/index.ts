import path from "node:path";

import { ensureDir, uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  CodeGraphDocument,
  ProjectContext,
  RepositoryFactGraphDocument,
  RepositoryFactGraphEdge,
  RepositoryFactGraphEdgeKind,
  RepositoryFactGraphNode,
  RepositoryFactGraphNodeKind
} from "../../shared/types";

interface RepositoryFactGraphBuildResult {
  graphPath: string;
  reportPath: string;
  graph: RepositoryFactGraphDocument;
}

function makeNode(
  id: string,
  label: string,
  kind: RepositoryFactGraphNodeKind,
  attributes?: RepositoryFactGraphNode["attributes"]
): RepositoryFactGraphNode {
  return { id, label, kind, attributes };
}

function makeEdge(
  kind: RepositoryFactGraphEdgeKind,
  from: string,
  to: string,
  evidencePath?: string,
  line?: number
): RepositoryFactGraphEdge {
  return { kind, from, to, evidencePath, line };
}

function edgeKey(edge: RepositoryFactGraphEdge): string {
  return `${edge.kind}:::${edge.from}:::${edge.to}:::${edge.evidencePath ?? ""}:::${edge.line ?? 0}`;
}

function topLevelDirectoryFor(filePath: string, topLevelDirectories: Set<string>): string | undefined {
  const [firstSegment] = filePath.split("/");
  if (!firstSegment || firstSegment === filePath || !topLevelDirectories.has(firstSegment)) {
    return undefined;
  }
  return firstSegment;
}

function countBy<T extends string>(values: T[]): Partial<Record<T, number>> {
  return values.reduce<Partial<Record<T, number>>>((accumulator, value) => {
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function renderCountList(items: Record<string, number>): string {
  const entries = Object.entries(items).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return entries.length > 0 ? entries.map(([label, count]) => `- ${label}: ${count}`).join("\n") : "- None";
}

function buildReport(
  context: ProjectContext,
  graphPath: string,
  graph: RepositoryFactGraphDocument,
  topConnectedFiles: Array<{ filePath: string; degree: number }>,
  exportedSymbols: string[]
): string {
  return `# Repository Fact Graph

## Summary

- Repository: ${context.repoName}
- Target path: ${context.targetPath}
- Generated at: ${graph.generatedAt}
- Code graph source files: ${graph.stats.codeGraphFiles}
- Code graph symbols: ${graph.stats.codeGraphSymbols}
- Fact graph nodes: ${graph.stats.nodes}
- Fact graph edges: ${graph.stats.edges}
- Fact graph JSON: ${graphPath}

## Verified repository facts

- Languages: ${context.discovery.languages.join(", ") || "Unknown"}
- Frameworks: ${context.discovery.frameworks.join(", ") || "None detected"}
- Dependency manifests: ${context.discovery.manifests.join(", ") || "None detected"}
- API files: ${context.discovery.apiFiles.join(", ") || "None detected"}
- Infrastructure files: ${context.discovery.infraFiles.join(", ") || "None detected"}
- Top-level directories: ${context.discovery.structure.topLevelDirectories.join(", ") || "None detected"}

## Graph inventory

### Node kinds

${renderCountList(graph.stats.nodeKinds)}

### Edge kinds

${renderCountList(graph.stats.edgeKinds)}

## Most connected files

${renderList(topConnectedFiles.map((entry) => `${entry.filePath} (degree=${entry.degree})`))}

## Exported symbols snapshot

${renderList(exportedSymbols)}

## Notes

- This artifact includes only verified structural relationships derived from repository discovery and the persisted code graph.
- No inferred or ambiguous edges are emitted in this report.
- File-level import, symbol containment, and call relationships depend on the current code_graph_v2 coverage.
`;
}

export async function buildRepositoryFactGraph(
  context: ProjectContext,
  codeGraph: CodeGraphDocument
): Promise<RepositoryFactGraphBuildResult> {
  const graphDir = path.join(context.runtimeMemoryDir, "knowledge_graph");
  const graphPath = path.join(graphDir, "repository_fact_graph.json");
  const reportPath = path.join(context.reportsDir, "repository_fact_graph.md");

  await ensureDir(graphDir);
  await ensureDir(path.dirname(reportPath));

  const nodeMap = new Map<string, RepositoryFactGraphNode>();
  const edgeMap = new Map<string, RepositoryFactGraphEdge>();
  const topLevelDirectories = new Set(context.discovery.structure.topLevelDirectories);
  const codeGraphFileIds = new Set(codeGraph.files.map((file) => file.filePath));
  const codeGraphSymbolIds = new Set(codeGraph.symbols.map((symbol) => symbol.id));
  const fileNodeId = (filePath: string) => `file:${filePath}`;
  const symbolNodeId = (symbolId: string) => `symbol:${symbolId}`;

  const addNode = (node: RepositoryFactGraphNode): void => {
    nodeMap.set(node.id, node);
  };

  const addEdge = (edge: RepositoryFactGraphEdge): void => {
    edgeMap.set(edgeKey(edge), edge);
  };

  const repositoryId = `repository:${context.repoName}`;
  addNode(
    makeNode(repositoryId, context.repoName, "repository", {
      targetPath: context.targetPath,
      scannedAt: context.scannedAt
    })
  );

  for (const directory of context.discovery.structure.topLevelDirectories) {
    const directoryId = `directory:${directory}`;
    addNode(makeNode(directoryId, directory, "directory"));
    addEdge(makeEdge("contains", repositoryId, directoryId));
  }

  for (const language of context.discovery.languages) {
    const languageId = `language:${language}`;
    addNode(makeNode(languageId, language, "language"));
    addEdge(makeEdge("uses_language", repositoryId, languageId));
  }

  for (const framework of context.discovery.frameworks) {
    const frameworkId = `framework:${framework}`;
    addNode(makeNode(frameworkId, framework, "framework"));
    addEdge(makeEdge("uses_framework", repositoryId, frameworkId));
  }

  for (const manifest of context.discovery.manifests) {
    const manifestId = `manifest:${manifest}`;
    addNode(makeNode(manifestId, manifest, "manifest", { filePath: manifest }));
    addEdge(makeEdge("has_manifest", repositoryId, manifestId, manifest));
  }

  for (const apiFile of context.discovery.apiFiles) {
    const apiId = `api:${apiFile}`;
    addNode(makeNode(apiId, apiFile, "api_surface", { filePath: apiFile }));
    addEdge(makeEdge("exposes_api", repositoryId, apiId, apiFile));
  }

  for (const infraFile of context.discovery.infraFiles) {
    const infraId = `infra:${infraFile}`;
    addNode(makeNode(infraId, infraFile, "infra_surface", { filePath: infraFile }));
    addEdge(makeEdge("defines_infra", repositoryId, infraId, infraFile));
  }

  for (const file of codeGraph.files) {
    const currentFileId = fileNodeId(file.filePath);
    addNode(
      makeNode(currentFileId, file.filePath, "file", {
        filePath: file.filePath,
        language: file.language,
        isTest: file.isTest,
        imports: file.imports.length
      })
    );

    const topLevelDirectory = topLevelDirectoryFor(file.filePath, topLevelDirectories);
    if (topLevelDirectory) {
      addEdge(makeEdge("contains", `directory:${topLevelDirectory}`, currentFileId, file.filePath));
    } else {
      addEdge(makeEdge("contains", repositoryId, currentFileId, file.filePath));
    }

    for (const importedFile of uniqueSorted(file.imports)) {
      if (!codeGraphFileIds.has(importedFile)) {
        continue;
      }
      addEdge(makeEdge("imports", currentFileId, fileNodeId(importedFile), file.filePath));
    }
  }

  for (const symbol of codeGraph.symbols) {
    const currentSymbolId = symbolNodeId(symbol.id);
    addNode(
      makeNode(currentSymbolId, symbol.qualifiedName, "symbol", {
        filePath: symbol.filePath,
        kind: symbol.kind,
        exported: symbol.exported,
        lineStart: symbol.lineStart,
        lineEnd: symbol.lineEnd
      })
    );
    addEdge(makeEdge("declares", fileNodeId(symbol.filePath), currentSymbolId, symbol.filePath, symbol.lineStart));
  }

  for (const edge of codeGraph.edges) {
    const from =
      codeGraphFileIds.has(edge.from) ? fileNodeId(edge.from) : codeGraphSymbolIds.has(edge.from) ? symbolNodeId(edge.from) : undefined;
    const to = codeGraphFileIds.has(edge.to) ? fileNodeId(edge.to) : codeGraphSymbolIds.has(edge.to) ? symbolNodeId(edge.to) : undefined;

    if (!from || !to) {
      continue;
    }

    addEdge(makeEdge(edge.kind, from, to, edge.filePath, edge.line));
  }

  const nodes = [...nodeMap.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  const edges = [...edgeMap.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to) ||
      (left.evidencePath ?? "").localeCompare(right.evidencePath ?? "") ||
      (left.line ?? 0) - (right.line ?? 0)
  );

  const degreeByNode = new Map<string, number>();
  for (const edge of edges) {
    degreeByNode.set(edge.from, (degreeByNode.get(edge.from) ?? 0) + 1);
    degreeByNode.set(edge.to, (degreeByNode.get(edge.to) ?? 0) + 1);
  }

  const topConnectedFiles = nodes
    .filter((node) => node.kind === "file")
    .map((node) => ({
      filePath: node.label,
      degree: degreeByNode.get(node.id) ?? 0
    }))
    .sort((left, right) => right.degree - left.degree || left.filePath.localeCompare(right.filePath))
    .slice(0, 10);

  const exportedSymbols = codeGraph.symbols
    .filter((symbol) => symbol.exported)
    .map((symbol) => `${symbol.qualifiedName} (${symbol.filePath}:${symbol.lineStart})`)
    .slice(0, 15);

  const graph: RepositoryFactGraphDocument = {
    version: 1,
    generatedAt: new Date().toISOString(),
    targetPath: context.targetPath,
    repoName: context.repoName,
    nodes,
    edges,
    stats: {
      nodes: nodes.length,
      edges: edges.length,
      codeGraphFiles: codeGraph.stats.files,
      codeGraphSymbols: codeGraph.stats.symbols,
      nodeKinds: countBy(nodes.map((node) => node.kind)),
      edgeKinds: countBy(edges.map((edge) => edge.kind))
    }
  };

  await writeJsonEnsured(graphPath, graph);
  await writeFileEnsured(reportPath, buildReport(context, graphPath, graph, topConnectedFiles, exportedSymbols));

  return {
    graphPath,
    reportPath,
    graph
  };
}
