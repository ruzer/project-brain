import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { readJsonSafe, toPosixPath, uniqueSorted, walkDirectory, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  CodeGraphBuildResult,
  CodeGraphDocument,
  CodeGraphEdge,
  CodeGraphEdgeKind,
  CodeGraphFileRecord,
  CodeGraphSymbol,
  ProjectContext
} from "../../shared/types";

const CODE_GRAPH_V2_FILE = "code_graph_v2.json";
const GRAPH_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function isGraphSource(filePath: string): boolean {
  return GRAPH_SOURCE_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

export function supportsCodeGraphV2(filePath: string): boolean {
  return isGraphSource(filePath);
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i.test(filePath) || /\.(test|spec)\.[^.]+$/i.test(filePath);
}

function fileLanguage(filePath: string): string {
  if (filePath.endsWith(".tsx")) {
    return "tsx";
  }
  if (filePath.endsWith(".ts")) {
    return "typescript";
  }
  if (filePath.endsWith(".jsx")) {
    return "jsx";
  }
  if (filePath.endsWith(".mjs")) {
    return "mjs";
  }
  if (filePath.endsWith(".cjs")) {
    return "cjs";
  }
  return "javascript";
}

function sortSymbols(symbols: CodeGraphSymbol[]): CodeGraphSymbol[] {
  return [...symbols].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.lineStart - right.lineStart ||
      left.id.localeCompare(right.id)
  );
}

function edgeKey(edge: CodeGraphEdge): string {
  return `${edge.kind}:::${edge.from}:::${edge.to}:::${edge.filePath}:::${edge.line}`;
}

function sortEdges(edges: CodeGraphEdge[]): CodeGraphEdge[] {
  return [...edges].sort(
    (left, right) =>
      left.filePath.localeCompare(right.filePath) ||
      left.kind.localeCompare(right.kind) ||
      left.from.localeCompare(right.from) ||
      left.to.localeCompare(right.to) ||
      left.line - right.line
  );
}

function defaultCompilerOptions(): ts.CompilerOptions {
  return {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    skipLibCheck: true,
    noEmit: true
  };
}

function loadCompilerOptions(targetPath: string): ts.CompilerOptions {
  const defaults = defaultCompilerOptions();
  const configPath = ts.findConfigFile(targetPath, ts.sys.fileExists, "tsconfig.json");

  if (!configPath) {
    return defaults;
  }

  try {
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    if (configFile.error) {
      return defaults;
    }

    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath));
    return {
      ...defaults,
      ...parsed.options,
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
      noEmit: true
    };
  } catch {
    return defaults;
  }
}

function lineNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function lineEndNumber(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export);
}

function maybeDefaultName(node: ts.Node): string | undefined {
  return Boolean(ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) ? "default" : undefined;
}

function symbolId(filePath: string, name: string, parentSymbolId?: string): string {
  return parentSymbolId ? `${parentSymbolId}.${name}` : `${filePath}#${name}`;
}

function isFunctionLikeInitializer(node: ts.Expression | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
  return Boolean(node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node)));
}

function propertyNameText(name: ts.PropertyName | ts.BindingName | undefined): string | undefined {
  if (!name) {
    return undefined;
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

async function fileHash(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return createHash("sha1").update(content).digest("hex");
}

function graphPathFor(context: ProjectContext): string {
  return path.join(context.runtimeMemoryDir, "code_graph", CODE_GRAPH_V2_FILE);
}

function emptyGraph(targetPath: string): CodeGraphDocument {
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    targetPath,
    nodes: [],
    edges: [],
    files: [],
    symbols: [],
    build: {
      mode: "full",
      updatedFiles: [],
      removedFiles: [],
      unchangedFiles: 0
    },
    stats: {
      files: 0,
      symbols: 0,
      nodes: 0,
      edges: 0,
      edgeKinds: {}
    }
  };
}

function resolveLocalImport(
  targetPath: string,
  fromFile: string,
  specifier: string,
  compilerOptions: ts.CompilerOptions,
  knownFiles: Set<string>
): string | undefined {
  const fromAbsolute = path.join(targetPath, fromFile);
  const resolution = ts.resolveModuleName(specifier, fromAbsolute, compilerOptions, ts.sys).resolvedModule;

  if (!resolution?.resolvedFileName) {
    return undefined;
  }

  const rawRelative = toPosixPath(path.relative(targetPath, resolution.resolvedFileName));
  const directMatch = rawRelative.replace(/^\.\/+/, "");
  if (knownFiles.has(directMatch)) {
    return directMatch;
  }

  if (directMatch.endsWith(".d.ts")) {
    const tsCandidate = directMatch.replace(/\.d\.ts$/, ".ts");
    const tsxCandidate = directMatch.replace(/\.d\.ts$/, ".tsx");
    const jsCandidate = directMatch.replace(/\.d\.ts$/, ".js");
    const jsxCandidate = directMatch.replace(/\.d\.ts$/, ".jsx");

    for (const candidate of [tsCandidate, tsxCandidate, jsCandidate, jsxCandidate]) {
      if (knownFiles.has(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

function aggregateDocument(
  targetPath: string,
  fileRecords: CodeGraphFileRecord[],
  mode: "full" | "incremental",
  updatedFiles: string[],
  removedFiles: string[],
  unchangedFiles: number
): CodeGraphDocument {
  const files = [...fileRecords].sort((left, right) => left.filePath.localeCompare(right.filePath));
  const symbolMap = new Map<string, CodeGraphSymbol>();
  const edgeMap = new Map<string, CodeGraphEdge>();

  for (const file of files) {
    for (const symbol of file.symbols) {
      symbolMap.set(symbol.id, symbol);
    }
    for (const edge of file.edges) {
      edgeMap.set(edgeKey(edge), edge);
    }
  }

  const symbols = sortSymbols([...symbolMap.values()]);
  const edges = sortEdges([...edgeMap.values()]);
  const nodes = uniqueSorted([...files.map((file) => file.filePath), ...symbols.map((symbol) => symbol.id)]);
  const edgeKinds: Partial<Record<CodeGraphEdgeKind, number>> = {};

  for (const edge of edges) {
    edgeKinds[edge.kind] = (edgeKinds[edge.kind] ?? 0) + 1;
  }

  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    targetPath,
    nodes,
    edges,
    files,
    symbols,
    build: {
      mode,
      updatedFiles,
      removedFiles,
      unchangedFiles
    },
    stats: {
      files: files.length,
      symbols: symbols.length,
      nodes: nodes.length,
      edges: edges.length,
      edgeKinds
    }
  };
}

function parseGraphFile(
  program: ts.Program,
  compilerOptions: ts.CompilerOptions,
  targetPath: string,
  filePath: string,
  hash: string,
  knownFiles: Set<string>
): CodeGraphFileRecord {
  const absolutePath = path.join(targetPath, filePath);
  const sourceFile = program.getSourceFile(absolutePath);

  if (!sourceFile) {
    return {
      filePath,
      hash,
      language: fileLanguage(filePath),
      isTest: isTestFile(filePath),
      imports: [],
      symbols: [],
      edges: []
    };
  }

  const imports = new Set<string>();
  const symbols: CodeGraphSymbol[] = [];
  const edges: CodeGraphEdge[] = [];
  const declarationIds = new WeakMap<ts.Node, string>();
  const topLevelSymbols = new Map<string, string>();
  const importedBindings = new Map<string, { targetFile: string; importedName: string }>();
  const testFile = isTestFile(filePath);

  const addEdge = (kind: CodeGraphEdgeKind, from: string, to: string, node: ts.Node): void => {
    edges.push({
      kind,
      from,
      to,
      filePath,
      line: lineNumber(sourceFile, node)
    });
  };

  const addSymbol = (
    name: string,
    kind: CodeGraphSymbol["kind"],
    node: ts.Node,
    exported: boolean,
    parentSymbolId?: string
  ): string => {
    const id = symbolId(filePath, name, parentSymbolId);
    symbols.push({
      id,
      name,
      qualifiedName: id,
      kind,
      filePath,
      exported,
      lineStart: lineNumber(sourceFile, node),
      lineEnd: lineEndNumber(sourceFile, node),
      parentSymbolId
    });
    addEdge("contains", parentSymbolId ?? filePath, id, node);
    declarationIds.set(node, id);

    if (!parentSymbolId) {
      topLevelSymbols.set(name, id);
    }

    return id;
  };

  const recordImport = (node: ts.ImportDeclaration): void => {
    if (!ts.isStringLiteral(node.moduleSpecifier)) {
      return;
    }

    const resolvedFile = resolveLocalImport(targetPath, filePath, node.moduleSpecifier.text, compilerOptions, knownFiles);
    if (!resolvedFile) {
      return;
    }

    imports.add(resolvedFile);
    addEdge("imports", filePath, resolvedFile, node.moduleSpecifier);

    const importClause = node.importClause;
    if (!importClause) {
      return;
    }

    if (importClause.name) {
      importedBindings.set(importClause.name.text, {
        targetFile: resolvedFile,
        importedName: "default"
      });
    }

    if (!importClause.namedBindings) {
      return;
    }

    if (ts.isNamespaceImport(importClause.namedBindings)) {
      importedBindings.set(importClause.namedBindings.name.text, {
        targetFile: resolvedFile,
        importedName: "*"
      });
      return;
    }

    for (const element of importClause.namedBindings.elements) {
      importedBindings.set(element.name.text, {
        targetFile: resolvedFile,
        importedName: element.propertyName?.text ?? element.name.text
      });
    }
  };

  const visitTopLevelStatement = (node: ts.Statement): void => {
    if (ts.isImportDeclaration(node)) {
      recordImport(node);
      return;
    }

    if (ts.isFunctionDeclaration(node)) {
      if (!node.body) {
        return;
      }

      const name = node.name?.text ?? maybeDefaultName(node);
      if (!name) {
        return;
      }

      addSymbol(name, testFile && /^test|smoke/i.test(name) ? "test" : "function", node, hasExportModifier(node));
      return;
    }

    if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? maybeDefaultName(node);
      if (!name) {
        return;
      }

      const classId = addSymbol(name, "class", node, hasExportModifier(node));

      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) && !ts.isConstructorDeclaration(member)) {
          continue;
        }
        if ("body" in member && !member.body) {
          continue;
        }

        const memberName = ts.isConstructorDeclaration(member) ? "constructor" : propertyNameText(member.name);
        if (!memberName) {
          continue;
        }

        addSymbol(memberName, "method", member, false, classId);
      }
      return;
    }

    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node);
      for (const declaration of node.declarationList.declarations) {
        const name = propertyNameText(declaration.name);
        if (!name) {
          continue;
        }

        const kind = testFile && /^test|smoke/i.test(name)
          ? "test"
          : isFunctionLikeInitializer(declaration.initializer)
            ? "function"
            : "variable";
        const id = addSymbol(name, kind, declaration, exported);

        if (isFunctionLikeInitializer(declaration.initializer)) {
          declarationIds.set(declaration.initializer, id);
        }
      }
      return;
    }

    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name?.text;
      if (name) {
        addSymbol(name, "interface", node, hasExportModifier(node));
      }
      return;
    }

    if (ts.isTypeAliasDeclaration(node)) {
      addSymbol(node.name.text, "type", node, hasExportModifier(node));
      return;
    }

    if (ts.isEnumDeclaration(node)) {
      addSymbol(node.name.text, "enum", node, hasExportModifier(node));
    }
  };

  for (const statement of sourceFile.statements) {
    visitTopLevelStatement(statement);
  }

  const resolveCallTarget = (expression: ts.LeftHandSideExpression): string | undefined => {
    if (ts.isIdentifier(expression)) {
      const local = topLevelSymbols.get(expression.text);
      if (local) {
        return local;
      }

      const imported = importedBindings.get(expression.text);
      if (!imported) {
        return undefined;
      }

      if (imported.importedName === "default") {
        return `${imported.targetFile}#default`;
      }
      if (imported.importedName === "*") {
        return imported.targetFile;
      }
      return `${imported.targetFile}#${imported.importedName}`;
    }

    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const imported = importedBindings.get(expression.expression.text);
      if (!imported) {
        return undefined;
      }
      return `${imported.targetFile}#${expression.name.text}`;
    }

    return undefined;
  };

  const walkCalls = (node: ts.Node, currentSymbolId?: string): void => {
    const nextSymbolId = declarationIds.get(node) ?? currentSymbolId;

    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && nextSymbolId) {
      const target = resolveCallTarget(node.expression);
      if (target) {
        addEdge("calls", nextSymbolId, target, node);
      }
    }

    ts.forEachChild(node, (child) => walkCalls(child, nextSymbolId));
  };

  walkCalls(sourceFile);

  return {
    filePath,
    hash,
    language: fileLanguage(filePath),
    isTest: testFile,
    imports: uniqueSorted([...imports]),
    symbols: sortSymbols(symbols),
    edges: sortEdges(edges)
  };
}

export async function buildOrUpdateCodeGraphV2(context: ProjectContext): Promise<CodeGraphBuildResult> {
  const graphPath = graphPathFor(context);
  const previous = await readJsonSafe<CodeGraphDocument>(graphPath);
  const relativeOutput = toPosixPath(path.relative(context.targetPath, context.outputPath));
  const excludePaths =
    !relativeOutput || relativeOutput === "." || relativeOutput.startsWith("../")
      ? []
      : [relativeOutput];
  const discoveredFiles = (await walkDirectory(context.targetPath, 12000, excludePaths)).filter(isGraphSource);
  const currentFiles = uniqueSorted(discoveredFiles.map((filePath) => filePath.replace(/^\.\/+/, "")));

  if (currentFiles.length === 0) {
    const graph = emptyGraph(context.targetPath);
    await writeJsonEnsured(graphPath, graph);
    return { graphPath, graph };
  }

  const currentHashes = new Map(
    await Promise.all(
      currentFiles.map(async (filePath) => [filePath, await fileHash(path.join(context.targetPath, filePath))] as const)
    )
  );
  const previousFiles = new Map((previous?.files ?? []).map((record) => [record.filePath, record]));
  const removedFiles = previous
    ? uniqueSorted([...previousFiles.keys()].filter((filePath) => !currentHashes.has(filePath)))
    : [];
  const changedFiles = previous
    ? uniqueSorted(
        currentFiles.filter((filePath) => previousFiles.get(filePath)?.hash !== currentHashes.get(filePath))
      )
    : currentFiles;
  const filesToParse = previous && removedFiles.length === 0 ? changedFiles : currentFiles;
  const mode: "full" | "incremental" = previous ? "incremental" : "full";
  const nextFiles = new Map(previousFiles);

  for (const removedFile of removedFiles) {
    nextFiles.delete(removedFile);
  }

  if (filesToParse.length > 0) {
    const compilerOptions = loadCompilerOptions(context.targetPath);
    const program = ts.createProgram({
      rootNames: currentFiles.map((filePath) => path.join(context.targetPath, filePath)),
      options: compilerOptions
    });
    const knownFiles = new Set(currentFiles);

    for (const filePath of filesToParse) {
      const hash = currentHashes.get(filePath);
      if (!hash) {
        continue;
      }
      nextFiles.set(
        filePath,
        parseGraphFile(program, compilerOptions, context.targetPath, filePath, hash, knownFiles)
      );
    }
  }

  const graph = aggregateDocument(
    context.targetPath,
    [...nextFiles.values()],
    mode,
    filesToParse,
    removedFiles,
    Math.max(currentFiles.length - filesToParse.length, 0)
  );
  await writeJsonEnsured(graphPath, graph);

  return {
    graphPath,
    graph
  };
}
