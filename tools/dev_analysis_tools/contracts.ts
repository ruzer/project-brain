import path from "node:path";

import type { RiskLevel } from "../../shared/types";

export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
export const IGNORED_PREFIXES = [
  "AI_CONTEXT/",
  "coverage/",
  "dist/",
  "docs/",
  "memory/learnings/",
  "node_modules/",
  "proposal/",
  "reports/",
  "sample-output/",
  "tasks/",
  "tests/"
];
export const RUNTIME_PREFIXES = ["analysis/", "cli/", "core/", "governance/", "integrations/", "memory/", "tools/"];

export type Difficulty = "low" | "medium" | "high";

export interface DependencyCruiserDependency {
  circular?: boolean;
  resolved?: string;
}

export interface DependencyCruiserModule {
  source: string;
  dependencies?: DependencyCruiserDependency[];
  dependents?: string[];
  orphan?: boolean;
}

export interface DependencyCruiserOutput {
  modules: DependencyCruiserModule[];
  summary?: {
    totalCruised: number;
    totalDependenciesCruised: number;
  };
}

export interface EslintMessage {
  ruleId: string | null;
  severity: number;
  message: string;
}

export interface EslintFileResult {
  filePath: string;
  messages: EslintMessage[];
}

export interface SourceSnapshot {
  filePath: string;
  content: string;
  lineCount: number;
  duplicateBlocks: number;
  hasStructuredLogging: boolean;
  hasErrorHandling: boolean;
  requiresErrorHandling: boolean;
  isTypeOnlyModule: boolean;
}

export interface DevArchitectureProposal {
  severity: RiskLevel;
  title: string;
  problemDescription: string;
  affectedFiles: string[];
  suggestedChange: string;
  estimatedDifficulty: Difficulty;
  confidenceScore: number;
}

export interface ModuleMetric {
  filePath: string;
  lineCount: number;
  inboundDependencies: number;
  outboundDependencies: number;
  couplingScore: number;
  duplicateBlocks: number;
  changeFrequency: number;
  changeSignal: string;
  complexityScore: number;
  performanceScore: number;
  hasStructuredLogging: boolean;
  hasErrorHandling: boolean;
}

export interface DevArchitectureAnalysis {
  moduleCount: number;
  dependencyGraph: {
    nodes: number;
    edges: number;
    couplingIndex: number;
    circularDependencies: string[][];
    orphanModules: string[];
    totalCruised: number;
    totalDependenciesCruised: number;
  };
  largestModules: ModuleMetric[];
  complexityHotspots: ModuleMetric[];
  isolationCandidates: ModuleMetric[];
  changeHotspots: ModuleMetric[];
  missingErrorHandling: ModuleMetric[];
  missingLogging: ModuleMetric[];
  unusedExports: Array<{ filePath: string; symbol: string }>;
  duplicationClusters: Array<{ sample: string; filePaths: string[]; occurrences: number }>;
  architectureObservations: string[];
  topArchitectureRisks: DevArchitectureProposal[];
  actionableProposals: DevArchitectureProposal[];
  eslintSummary: {
    checked: boolean;
    oversizedFiles: string[];
    complexityWarnings: string[];
    error?: string;
  };
  notes: string[];
}

export function isSourceFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");

  return (
    SOURCE_EXTENSIONS.has(path.posix.extname(normalized)) &&
    !IGNORED_PREFIXES.some((prefix) => normalized.startsWith(prefix)) &&
    !/(^|\/)(__tests__|tests?|spec)(\/|\.|$)/i.test(normalized)
  );
}

export function hasLogging(content: string): boolean {
  return /StructuredLogger|logger\.(info|warn|error|debug)|console\.(info|warn|error|debug)|pino|winston/.test(content);
}

export function hasErrorHandling(content: string): boolean {
  return /\btry\s*\{|\.catch\s*\(/.test(content);
}

export function requiresErrorHandling(content: string): boolean {
  return /\basync\b|\bawait\b|Promise<|\b(readFile|writeFile|appendFile|mkdir|rm|exec)\b|JSON\.parse|fs\./.test(content);
}

export function isTypeOnlyModule(content: string): boolean {
  const meaningfulLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"));

  return (
    meaningfulLines.length > 0 &&
    meaningfulLines.every((line) =>
      /^(export\s+)?(type|interface)\b/.test(line) ||
      /^import\s+type\b/.test(line) ||
      /^import\s*\{[^}]+\}\s+from/.test(line)
    )
  );
}

export function severityWeight(severity: RiskLevel): number {
  if (severity === "high") {
    return 3;
  }
  if (severity === "medium") {
    return 2;
  }
  return 1;
}

export function roundMetric(value: number): number {
  return Number(value.toFixed(2));
}

export function emptyDevArchitectureAnalysis(note: string): DevArchitectureAnalysis {
  return {
    moduleCount: 0,
    dependencyGraph: {
      nodes: 0,
      edges: 0,
      couplingIndex: 0,
      circularDependencies: [],
      orphanModules: [],
      totalCruised: 0,
      totalDependenciesCruised: 0
    },
    largestModules: [],
    complexityHotspots: [],
    isolationCandidates: [],
    changeHotspots: [],
    missingErrorHandling: [],
    missingLogging: [],
    unusedExports: [],
    duplicationClusters: [],
    architectureObservations: [note],
    topArchitectureRisks: [],
    actionableProposals: [],
    eslintSummary: {
      checked: false,
      oversizedFiles: [],
      complexityWarnings: [],
      error: note
    },
    notes: [note]
  };
}
