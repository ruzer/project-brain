export type RiskLevel = "low" | "medium" | "high";
export type AgentAction = "analyze" | "propose" | "report";
export type FirewallPolicyPack = "safe-readonly" | "review" | "edit-limited" | "deploy";
export type FirewallDecision = "ALLOW" | "ALLOW_WITH_REVIEW" | "BLOCKED";
export type ContextTrustLevel = "official" | "maintainer" | "community";
export type AskWorkflow =
  | "resume-project"
  | "discover-project"
  | "critical-gaps"
  | "review-latest-changes"
  | "inspect-firewall"
  | "build-code-graph";
export type FirewallTool =
  | "read-repository"
  | "read-generated-context"
  | "write-generated-artifacts"
  | "run-tests"
  | "run-build"
  | "write-target-files"
  | "delete-target-files"
  | "read-git"
  | "write-git"
  | "network-egress"
  | "deploy";
export type FirewallToolMode = "allow" | "approval-required" | "deny";
export type GovernanceTrigger =
  | "manual"
  | "repository-change"
  | "weekly-review"
  | "security-audit"
  | "architecture-review"
  | "incident-detection"
  | "dependency-update"
  | "security-advisory";
export type AgentMessageType = "ANALYSIS_RESULT" | "PROPOSAL" | "QUESTION" | "FEEDBACK" | "ESCALATION";
export type TaskState = "NEW" | "ANALYZING" | "PROPOSED" | "APPROVED" | "REJECTED" | "ARCHIVED";
export type ProposalStatus = "APPROVED" | "REQUIRES_HUMAN_REVIEW" | "REJECTED";
export type WorkflowStage = "ANALYZE" | "PROPOSE" | "PROPOSE_PATCHES" | "REPORT";
export type ProposalConsensusState = "strong" | "moderate" | "weak";
export type CodeGraphNodeKind =
  | "file"
  | "function"
  | "class"
  | "method"
  | "variable"
  | "interface"
  | "type"
  | "enum"
  | "test";
export type CodeGraphEdgeKind = "imports" | "contains" | "calls";
export type LearningOutcome =
  | "SUCCESSFUL_PROPOSAL"
  | "REJECTED_PROPOSAL"
  | "FALSE_POSITIVE"
  | "MISSED_ISSUE"
  | "ARCHITECTURAL_INSIGHT"
  | "REPEATED_BUG_PATTERN"
  | "PENDING_REVIEW";
export type AgentPriority = "critical" | "high" | "normal" | "low";

export interface RepoStructure {
  topLevelDirectories: string[];
  sampleFiles: string[];
  subrepos: string[];
  submodules: string[];
  fileCount: number;
  sourceFileCount: number;
  testFileCount: number;
}

export interface BasicRepoScan {
  repoName: string;
  targetPath: string;
  scannedAt: string;
  files: string[];
  languages: string[];
  structure: RepoStructure;
}

export interface DependencyManifest {
  path: string;
  ecosystem: string;
  dependencies: string[];
}

export interface DependencyScanResult {
  manifests: string[];
  dependencies: DependencyManifest[];
  frameworks: string[];
  testing: string[];
}

export interface ApiScanResult {
  apis: string[];
  apiFiles: string[];
}

export interface InfraScanResult {
  infrastructure: string[];
  infraFiles: string[];
  dockerStageCount: number;
}

export interface GitInfo {
  isGitRepo: boolean;
  branch?: string;
  latestCommit?: string;
  hasSubmodules: boolean;
}

export interface CiInfo {
  providers: string[];
  configFiles: string[];
}

export interface LoggingInfo {
  frameworks: string[];
  configFiles: string[];
  structured: boolean;
}

export interface MetricsInfo {
  tools: string[];
  configFiles: string[];
  alertsConfigured: boolean;
}

export interface DiscoveryResult {
  repoName: string;
  targetPath: string;
  scannedAt: string;
  files: string[];
  structure: RepoStructure;
  languages: string[];
  frameworks: string[];
  apis: string[];
  infrastructure: string[];
  testing: string[];
  dependencies: DependencyManifest[];
  manifests: string[];
  apiFiles: string[];
  infraFiles: string[];
  dockerStageCount: number;
  git: GitInfo;
  ci: CiInfo;
  logging: LoggingInfo;
  metrics: MetricsInfo;
  recommendations: string[];
}

export interface ProjectContext {
  repoName: string;
  targetPath: string;
  outputPath: string;
  scannedAt: string;
  discovery: DiscoveryResult;
  memoryDir: string;
  reportsDir: string;
  docsDir: string;
  runtimeMemoryDir: string;
  learningDir: string;
  taskBoardDir: string;
  proposalDir: string;
  patchProposalDir: string;
}

export interface RepositoryTarget {
  repoName: string;
  targetPath: string;
  relativePath: string;
}

export interface AgentReport {
  agentId: string;
  title: string;
  summary: string;
  findings: string[];
  recommendations: string[];
  riskLevel: RiskLevel;
  outputPath: string;
}

export interface AgentDescriptor {
  agentId: string;
  displayName: string;
  version: string;
  capabilities: string[];
  allowedActions: AgentAction[];
  triggers: GovernanceTrigger[];
  requiresHumanApprovalFor: string[];
}

export interface AgentTask {
  taskId: string;
  agentId: string;
  title: string;
  description: string;
  trigger: GovernanceTrigger;
  priority: AgentPriority;
  state: TaskState;
  createdAt: string;
  claimedAt?: string;
  completedAt?: string;
  rationale: string;
  reportPath?: string;
}

export interface FirewallToolRule {
  tool: FirewallTool;
  mode: FirewallToolMode;
  rationale: string;
}

export interface AgentTaskPacket {
  taskId: string;
  agentId: string;
  trigger: GovernanceTrigger;
  goal: string;
  scopePaths: string[];
  contextPaths: string[];
  constraints: string[];
  expectedOutput: string[];
  policyPack: FirewallPolicyPack;
  riskLevel: RiskLevel;
  decision: FirewallDecision;
  decisionRationale: string;
  requiresHumanApproval: boolean;
  requiredApprovals: string[];
  toolRules: FirewallToolRule[];
  packetPath: string;
}

export interface FirewallSummary {
  generatedAt: string;
  trigger: GovernanceTrigger;
  reportPath: string;
  policyPath: string;
  packetDir: string;
  packets: AgentTaskPacket[];
  stats: {
    allowed: number;
    reviewRequired: number;
    blocked: number;
    lowRisk: number;
    mediumRisk: number;
    highRisk: number;
    byPolicyPack: Record<FirewallPolicyPack, number>;
  };
}

export interface AskRoute {
  workflow: AskWorkflow;
  reason: string;
  trigger: GovernanceTrigger;
  followUps: string[];
}

export interface AskArtifact {
  label: string;
  path: string;
}

export interface AskResult {
  intent: string;
  workflow: AskWorkflow;
  targetPath: string;
  outputPath: string;
  scopeMode: "repository" | "workspace";
  briefPath: string;
  headline: string;
  summary: string[];
  artifacts: AskArtifact[];
  followUps: string[];
  routingReason: string;
  guidedExecution?: {
    label: string;
    command: string;
    headline: string;
    summary: string[];
    artifacts: AskArtifact[];
  };
  aiAssistance?: {
    provider: string;
    model: string;
    profile: string;
    residency: string;
    summary: string[];
    suggestedWorkflow?: AskWorkflow;
  };
}

export interface SwarmPlanTask {
  taskId: string;
  title: string;
  goal: string;
  profile: "worker" | "reviewer" | "reasoning" | "planner" | "synthesizer";
  deliverable: string;
}

export interface SwarmWorkerResult {
  taskId: string;
  parentTaskId: string;
  chunkId: string;
  attempt: number;
  status: "completed" | "timed_out" | "failed";
  title: string;
  profile: "worker" | "reviewer" | "reasoning" | "planner" | "synthesizer";
  scopePaths: string[];
  provider: string;
  model: string;
  residency: string;
  summary: string;
  findings: string[];
  recommendations: string[];
  error?: string;
}

export type SwarmEngine = "bounded" | "deepagents";

export interface SwarmRunResult {
  engine: SwarmEngine;
  context: ProjectContext;
  intent: string;
  reportPath: string;
  memoryPath: string;
  resilience: {
    runTimeoutMs: number;
    requestedRunTimeoutMs?: number;
    plannerTimeoutMs: number;
    requestedPlannerTimeoutMs?: number;
    synthesisTimeoutMs: number;
    requestedSynthesisTimeoutMs?: number;
    taskTimeoutMs: number;
    requestedTaskTimeoutMs?: number;
    maxRetries: number;
    queueBudget: number;
    requestedQueueBudget?: number;
    plannerTimedOut: boolean;
    synthesisTimedOut: boolean;
    runTimedOut: boolean;
    timedOutTasks: number;
    retriedTasks: number;
    splitTasks: number;
    failedTasks: number;
    droppedTasks: number;
    localBudgetMode: boolean;
    adaptiveQueueBudget: boolean;
  };
  chunking: {
    selectedChunkSize: number;
    requestedChunkSize?: number;
    scopeUnits: number;
    scopeChunks: number;
    queuedTasks: number;
    queueStrategy: "round-robin";
    scopeBias: "balanced" | "source-first";
    scopeHints: string[];
  };
  parallelism: {
    selected: number;
    requested?: number;
    cpuCount: number;
    loadAverage1m: number;
    freeMemoryMb: number;
    totalMemoryMb: number;
    pressure: "low" | "medium" | "high";
  };
  planner: {
    provider: string;
    model: string;
    residency: string;
    overview: string;
  };
  tasks: SwarmPlanTask[];
  workerResults: SwarmWorkerResult[];
  synthesis: {
    provider: string;
    model: string;
    residency: string;
    headline: string;
    summary: string;
    priorities: string[];
    nextSteps: string[];
  };
}

export type DoctorCheckStatus = "pass" | "warn" | "fail";
export type SuggestedActionPriority = "high" | "medium" | "low";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
  details: string[];
}

export interface SuggestedAction {
  label: string;
  command: string;
  rationale: string;
  priority: SuggestedActionPriority;
}

export interface DoctorResult {
  context: ProjectContext;
  reportPath: string;
  memoryPath: string;
  summary: {
    passed: number;
    warnings: number;
    failed: number;
    headline: string;
  };
  checks: DoctorCheck[];
  suggestions: SuggestedAction[];
}

export interface StatusArtifactSummary {
  label: string;
  path: string;
  exists: boolean;
  updatedAt?: string;
}

export interface StatusResult {
  context: ProjectContext;
  reportPath: string;
  memoryPath: string;
  git: {
    isGitRepo: boolean;
    branch?: string;
  };
  summary: {
    headline: string;
    artifactCount: number;
    doctorStatus: DoctorCheckStatus | "unknown";
    swarmStatus: "available" | "missing";
    planStatus: "available" | "missing";
  };
  artifacts: StatusArtifactSummary[];
  suggestions: SuggestedAction[];
}

export type ResumeStage =
  | "bootstrap"
  | "doctor"
  | "ask"
  | "map-codebase"
  | "firewall"
  | "review-delta"
  | "swarm"
  | "plan-improvements";

export interface ResumeResult {
  context: ProjectContext;
  reportPath: string;
  memoryPath: string;
  git: {
    isGitRepo: boolean;
    branch?: string;
  };
  summary: {
    headline: string;
    stage: ResumeStage;
    artifactCount: number;
    latestArtifactLabel?: string;
    latestArtifactUpdatedAt?: string;
  };
  latestArtifact?: StatusArtifactSummary;
  artifacts: StatusArtifactSummary[];
  notes: string[];
  suggestions: SuggestedAction[];
}

export interface ImprovementPlanResult {
  context: ProjectContext;
  planDir: string;
  summaryPath: string;
  statePath: string;
  risksPath: string;
  roadmapPath: string;
  tracksPath: string;
}

export interface ContextRegistryEntry {
  id: string;
  title: string;
  category: string;
  trustLevel: ContextTrustLevel;
  source: string;
  sourceUrl: string;
  summary: string;
  tags: string[];
  guidance: string[];
  relatedIds: string[];
}

export interface ContextSearchHit {
  entry: ContextRegistryEntry;
  score: number;
  matchedTags: string[];
}

export interface ContextSearchResult {
  context: ProjectContext;
  query: string;
  reportPath: string;
  cachePath: string;
  hits: ContextSearchHit[];
}

export interface ContextGetResult {
  context: ProjectContext;
  entry: ContextRegistryEntry;
  artifactPath: string;
  cachePath: string;
}

export interface ContextSourcesResult {
  context: ProjectContext;
  reportPath: string;
  sources: Array<{
    source: string;
    trustLevel: ContextTrustLevel;
    entries: number;
  }>;
}

export interface AgentMessage {
  messageId: string;
  sender: string;
  recipient: string;
  taskId: string;
  type: AgentMessageType;
  payload: Record<string, unknown>;
  priority: AgentPriority;
  timestamp: string;
}

export interface AgentEvaluationScore {
  agentId: string;
  taskId: string;
  outputQuality: number;
  proposalQuality: number;
  signalStrength: number;
  riskAlignment: number;
  overallScore: number;
  rank: number;
  notes: string[];
}

export interface LearningRecord {
  lessonId: string;
  agentId: string;
  taskId: string;
  context: string;
  detectedProblem: string;
  actionTaken: string;
  outcome: LearningOutcome;
  confidenceScore: number;
  createdAt: string;
}

export interface ProposalArtifact {
  proposalId: string;
  agentId: string;
  title: string;
  summary: string;
  status: ProposalStatus;
  consensusScore: number;
  consensusState: ProposalConsensusState;
  supportingAgents: string[];
  consensusThemes: string[];
  filePath: string;
  riskLevel: RiskLevel;
  affectedFiles: string[];
  expectedBenefit: string;
  implementationSketch: string;
  decisionRationale: string;
  sourceReportPath: string;
  createdAt: string;
}

export interface PatchProposalArtifact {
  patchId: string;
  agentId: string;
  stage: WorkflowStage;
  title: string;
  filePath: string;
  targetFile: string;
  sourceTaskPath: string;
  riskLevel: RiskLevel;
  effort: "Low" | "Medium" | "High";
  requiresHumanApproval: boolean;
  createdAt: string;
}

export interface AgentExecutionRecord {
  agentId: string;
  taskId: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  error?: string;
}

export interface GovernanceSummary {
  trigger: GovernanceTrigger;
  tasks: AgentTask[];
  messages: AgentMessage[];
  evaluations: AgentEvaluationScore[];
  learnings: LearningRecord[];
  proposals: ProposalArtifact[];
  patchProposals?: PatchProposalArtifact[];
  executionRecords: AgentExecutionRecord[];
  agentActivityReportPath: string;
  improvementReportPath: string;
  firewall?: FirewallSummary;
}

export interface AgentEvaluation {
  title: string;
  summary: string;
  findings: string[];
  recommendations: string[];
  riskLevel: RiskLevel;
  deterministicFindings?: string[];
  aiInsights?: string[];
  combinedRecommendations?: string[];
  content?: string;
}

export interface ReportManifest {
  memoryFiles: string[];
  reportFiles: string[];
  docFiles: string[];
  learningFiles: string[];
  taskFiles: string[];
  swarmFiles?: string[];
  firewallFiles?: string[];
  contextRegistryFiles?: string[];
  proposalFiles: string[];
  knowledgeFiles?: string[];
  patchProposalFiles?: string[];
}

export interface CodebaseMapArtifact {
  repoName: string;
  outputPath: string;
  codebaseMapDir: string;
  files: string[];
  summaryPath: string;
}

export interface ContextAnnotation {
  scope: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface CodeGraphSymbol {
  id: string;
  name: string;
  qualifiedName: string;
  kind: CodeGraphNodeKind;
  filePath: string;
  exported: boolean;
  lineStart: number;
  lineEnd: number;
  parentSymbolId?: string;
}

export interface CodeGraphEdge {
  kind: CodeGraphEdgeKind;
  from: string;
  to: string;
  filePath: string;
  line: number;
}

export interface CodeGraphFileRecord {
  filePath: string;
  hash: string;
  language: string;
  isTest: boolean;
  imports: string[];
  symbols: CodeGraphSymbol[];
  edges: CodeGraphEdge[];
}

export interface CodeGraphDocument {
  version: 2;
  generatedAt: string;
  targetPath: string;
  nodes: string[];
  edges: CodeGraphEdge[];
  files: CodeGraphFileRecord[];
  symbols: CodeGraphSymbol[];
  build: {
    mode: "full" | "incremental";
    updatedFiles: string[];
    removedFiles: string[];
    unchangedFiles: number;
  };
  stats: {
    files: number;
    symbols: number;
    nodes: number;
    edges: number;
    edgeKinds: Partial<Record<CodeGraphEdgeKind, number>>;
  };
}

export interface CodeGraphBuildResult {
  graphPath: string;
  graph: CodeGraphDocument;
}

export interface ImpactAnalysisResult {
  targetPath: string;
  outputPath: string;
  changedFiles: string[];
  directDependents: string[];
  transitiveDependents: string[];
  impactedTests: string[];
  reviewFiles: string[];
  unresolvedImports: string[];
  graphPath: string;
  reportPath: string;
  graphStats: {
    nodes: number;
    edges: number;
    files: number;
    symbols: number;
    buildMode: "full" | "incremental";
    updatedFiles: number;
  };
}

export interface CodebaseMapResult extends CodebaseMapArtifact {
  context: ProjectContext;
}

export interface EcosystemCodebaseMapRepositoryResult extends CodebaseMapArtifact {
  relativePath: string;
  targetPath: string;
}

export interface EcosystemCodebaseMapResult {
  rootPath: string;
  outputPath: string;
  repositories: EcosystemCodebaseMapRepositoryResult[];
  summaryPath: string;
}

export interface OrchestrationResult {
  context: ProjectContext;
  agentReports: AgentReport[];
  weeklyReportPath: string;
  riskReportPath: string;
  governanceSummary?: GovernanceSummary;
}

export interface FirewallInspectionResult {
  context: ProjectContext;
  firewall: FirewallSummary;
}

export interface EcosystemRepositoryResult {
  repoName: string;
  relativePath: string;
  targetPath: string;
  outputPath: string;
  result: OrchestrationResult;
}

export interface EcosystemAnalysisResult {
  rootPath: string;
  outputPath: string;
  trigger: GovernanceTrigger;
  repositories: EcosystemRepositoryResult[];
  knowledgeGraphPath: string;
  ecosystemReportPath: string;
  telemetryPath: string;
  runtimeObservabilityPath: string;
  proposalPaths: string[];
}
