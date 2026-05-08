export type RiskLevel = "low" | "medium" | "high";
export type AgentAction = "analyze" | "propose" | "report";
export type FirewallPolicyPack = "safe-readonly" | "review" | "edit-limited" | "deploy";
export type FirewallDecision = "ALLOW" | "ALLOW_WITH_REVIEW" | "BLOCKED";
export type ContextTrustLevel = "official" | "maintainer" | "community";
export type AskWorkflow =
  | "resume-project"
  | "discover-project"
  | "security-audit"
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
export type RepositoryFactGraphNodeKind =
  | "repository"
  | "directory"
  | "file"
  | "symbol"
  | "language"
  | "framework"
  | "manifest"
  | "api_surface"
  | "infra_surface";
export type RepositoryFactGraphEdgeKind =
  | "contains"
  | "uses_language"
  | "uses_framework"
  | "has_manifest"
  | "exposes_api"
  | "defines_infra"
  | "declares"
  | "imports"
  | "calls";
export type LearningOutcome =
  | "SUCCESSFUL_PROPOSAL"
  | "REJECTED_PROPOSAL"
  | "FALSE_POSITIVE"
  | "MISSED_ISSUE"
  | "ARCHITECTURAL_INSIGHT"
  | "REPEATED_BUG_PATTERN"
  | "PENDING_REVIEW";
export type AgentPriority = "critical" | "high" | "normal" | "low";
export type SecurityFindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type SecurityFindingProblemType = "code" | "configuration" | "architecture" | "code+configuration";
export type SecurityFixEffort = "low" | "medium" | "high";
export type SecurityAuditArea =
  | "auth_sessions"
  | "authorization"
  | "input_validation"
  | "web_attacks"
  | "http_headers"
  | "infra_config"
  | "abuse_protection"
  | "sensitive_data"
  | "observability";

export interface SecurityFinding {
  area: SecurityAuditArea;
  severity: SecurityFindingSeverity;
  title: string;
  location: string;
  evidence: string;
  attackVector: string[];
  impact: string;
  fix: string;
  references: string[];
  effort: SecurityFixEffort;
  problemType: SecurityFindingProblemType;
  agentId: string;
}

export interface SecurityCoverageStatus {
  area: SecurityAuditArea;
  status: "finding" | "ok" | "not-reviewed";
  note: string;
  agentId?: string;
}

export interface VerifiedAppContext {
  architectureSummary: string[];
  attackSurface: string[];
  criticalAssets: string[];
  trustBoundaries: string[];
  contextGaps: string[];
}

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
  securityFindings?: SecurityFinding[];
  coverage?: SecurityCoverageStatus[];
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
  preflightFacts?: PreflightFactsResult;
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

export type PreflightFactsConfidence = "none" | "low" | "medium" | "high";
export type PreflightFactsNextAction =
  | "answer-from-memory"
  | "run-code-graph"
  | "run-fact-query"
  | "run-swarm-delta"
  | "continue-workflow";

export interface PreflightFactsResult {
  intent: string;
  scope?: string;
  query: string;
  factsFound: boolean;
  facts: string[];
  evidence: string[];
  freshness: {
    freshScopes: string[];
    staleScopes: string[];
    missingScopes: string[];
  };
  staleIgnored: string[];
  confidence: PreflightFactsConfidence;
  recommendedNextAction: PreflightFactsNextAction;
  readiness: {
    hasMemoryBrief: boolean;
    hasExecutiveSummary: boolean;
    hasFactGraph: boolean;
    hasFreshScopeMemory: boolean;
  };
  sources: {
    memoryBriefPath: string;
    memoryBriefJsonPath: string;
    executiveSummaryPath: string;
    executiveSummaryJsonPath: string;
    repositoryFactGraphPath: string;
    scopeMemoryDir: string;
  };
  unknowns: string[];
}

export interface SwarmPlanTask {
  taskId: string;
  title: string;
  goal: string;
  profile: "worker" | "reviewer" | "reasoning" | "planner" | "synthesizer";
  deliverable: string;
  dependsOn?: string[];
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
  verifiedFacts?: string[];
  unknowns?: string[];
  evidenceRefs?: string[];
  error?: string;
}

export interface ScopeMemoryFileHash {
  path: string;
  sha256?: string;
  missing?: boolean;
}

export interface ScopeMemoryRecord {
  version: 1;
  repoName: string;
  targetPath: string;
  scope: string;
  scopeKey: string;
  updatedAt: string;
  generatedBy: {
    command: "swarm";
    intent: string;
    provider?: string;
    model?: string;
  };
  files: {
    count: number;
    totalCount?: number;
    hashTruncated?: boolean;
    hashed: ScopeMemoryFileHash[];
  };
  coverage: {
    status: "complete" | "partial" | "failed" | "timed_out";
    workerTaskIds: string[];
    completedWorkers: number;
    failedWorkers: number;
    timedOutWorkers: number;
  };
  freshness: {
    status: "fresh" | "stale";
    changedFiles: string[];
    missingFiles: string[];
    unchangedFiles: number;
  };
  decisions: string[];
  verifiedFacts: string[];
  unknowns: string[];
  evidenceRefs: string[];
  nextActions: string[];
  sourceArtifacts: string[];
}

export interface ScopeMemoryLookupResult {
  records: ScopeMemoryRecord[];
  hits: number;
  misses: number;
  stale: number;
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
  optimization?: {
    cacheHits: number;
    cacheMisses: number;
    cacheWrites: number;
    scopeMemoryHits?: number;
    scopeMemoryMisses?: number;
    scopeMemoryStale?: number;
    scopeMemoryWrites?: number;
    scopeMemoryReuseCandidates?: number;
    scopeMemoryReductionHints?: string[];
    derivedTasksQueued: number;
    derivedTasksSkipped: number;
    learnedScopeBoosts: string[];
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
    verifiedFacts?: string[];
    unknowns?: string[];
    evidenceRefs?: string[];
  };
}

export type DoctorCheckStatus = "pass" | "warn" | "fail";
export type SuggestedActionPriority = "high" | "medium" | "low";
export type DoctorSetupTier = "required" | "recommended" | "optional";
export type DoctorSetupStatus = "installed" | "missing";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  summary: string;
  details: string[];
}

export interface DoctorSetupItem {
  id: string;
  label: string;
  tier: DoctorSetupTier;
  status: DoctorSetupStatus;
  summary: string;
  installHint: string;
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
  setupItems: DoctorSetupItem[];
  suggestions: SuggestedAction[];
}

export interface StatusArtifactSummary {
  label: string;
  path: string;
  exists: boolean;
  updatedAt?: string;
}

export type MemoryReadinessStatus = "ready" | "missing" | "stale" | "invalid";

export interface MemoryReadinessResult {
  status: MemoryReadinessStatus;
  memoryBriefPath: string;
  memoryBriefJsonPath: string;
  generatedAt?: string;
  ageHours?: number;
  maxAgeHours: number;
  factsCount: number;
  evidenceCount: number;
  tokenGuidanceCount: number;
  reason: string;
}

export interface ExecutiveSummaryScopeStatus {
  scope: string;
  freshness: "fresh" | "stale";
  coverage: "complete" | "partial" | "failed" | "timed_out";
  facts: number;
  unknowns: number;
  evidenceRefs: number;
  hashTruncated: boolean;
}

export interface ExecutiveSummaryResult {
  context: ProjectContext;
  generatedAt: string;
  reportPath: string;
  memoryPath: string;
  identity: {
    repoName: string;
    targetPath: string;
    outputPath: string;
    projectType: string;
  };
  stack: {
    languages: string[];
    frameworks: string[];
    apis: string[];
    infrastructure: string[];
    testing: string[];
  };
  architecture: {
    topLevelDirectories: string[];
    sourceFileCount: number;
    testFileCount: number;
  };
  status: {
    scopeCount: number;
    completeFreshScopes: number;
    staleScopes: number;
    partialScopes: number;
    latestSwarmIntent?: string;
    latestSwarmHeadline?: string;
  };
  decisions: string[];
  learnings: string[];
  risksAndUnknowns: string[];
  scopeStatuses: ExecutiveSummaryScopeStatus[];
  nextActions: string[];
  evidenceRefs: string[];
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
  memoryReadiness: MemoryReadinessResult;
  executiveSummary: ExecutiveSummaryResult;
  artifacts: StatusArtifactSummary[];
  suggestions: SuggestedAction[];
}

export type ResumeStage =
  | "bootstrap"
  | "start"
  | "doctor"
  | "ask"
  | "map-codebase"
  | "fact-query"
  | "runbook"
  | "harness-audit"
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
  memoryReadiness: MemoryReadinessResult;
  executiveSummary: ExecutiveSummaryResult;
  artifacts: StatusArtifactSummary[];
  notes: string[];
  suggestions: SuggestedAction[];
}

export interface StartStep {
  id: string;
  label: string;
  status: "done" | "skipped" | "suggested";
  command: string;
  summary: string;
}

export interface StartResult {
  context: ProjectContext;
  intent: string;
  reportPath: string;
  memoryPath: string;
  headline: string;
  memoryReadiness: MemoryReadinessResult;
  executiveSummary: ExecutiveSummaryResult;
  executedSteps: StartStep[];
  nextCommand?: string;
  artifacts: StatusArtifactSummary[];
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

export interface SecurityAuditResult {
  context: ProjectContext;
  trigger: GovernanceTrigger;
  reportPath: string;
  memoryPath: string;
  contextLiteReportPath?: string;
  verifiedContext: VerifiedAppContext;
  findings: SecurityFinding[];
  coverage: SecurityCoverageStatus[];
  checklist: string[];
  securityDebt: string[];
  sourceReports: string[];
  verdict: "No apta para producción" | "Apta con remediaciones obligatorias" | "Apta con hardening recomendado";
  headline: string;
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

export interface EcosystemRadarCandidate {
  entry: ContextRegistryEntry;
  repoFullName: string;
  bucketId: string;
  score: number;
  stars: number;
  forks: number;
  primaryLanguage?: string;
  pushedAt?: string;
  reasons: string[];
}

export interface EcosystemRadarResult {
  context: ProjectContext;
  reportPath: string;
  cachePath: string;
  candidates: EcosystemRadarCandidate[];
  notes: string[];
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
  securityFindings?: SecurityFinding[];
  coverage?: SecurityCoverageStatus[];
}

export interface ReportManifest {
  memoryFiles: string[];
  reportFiles: string[];
  docFiles: string[];
  learningFiles: string[];
  taskFiles: string[];
  swarmFiles?: string[];
  firewallFiles?: string[];
  securityFiles?: string[];
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
  factGraphPath?: string;
  factReportPath?: string;
  factGraph?: RepositoryFactGraphDocument;
}

export interface RepositoryFactGraphNode {
  id: string;
  label: string;
  kind: RepositoryFactGraphNodeKind;
  attributes?: Record<string, string | number | boolean>;
}

export interface RepositoryFactGraphEdge {
  kind: RepositoryFactGraphEdgeKind;
  from: string;
  to: string;
  evidencePath?: string;
  line?: number;
}

export interface RepositoryFactGraphDocument {
  version: 1;
  generatedAt: string;
  targetPath: string;
  repoName: string;
  nodes: RepositoryFactGraphNode[];
  edges: RepositoryFactGraphEdge[];
  stats: {
    nodes: number;
    edges: number;
    codeGraphFiles: number;
    codeGraphSymbols: number;
    nodeKinds: Partial<Record<RepositoryFactGraphNodeKind, number>>;
    edgeKinds: Partial<Record<RepositoryFactGraphEdgeKind, number>>;
  };
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

export interface ContextLiteResult {
  context: ProjectContext;
  reportPath: string;
  artifactPaths: string[];
  summary: string[];
  openQuestions: string[];
}

export interface FactQueryResult {
  query: string;
  answer: string;
  tokens: string[];
  reportPath: string;
  memoryPath: string;
  sources: {
    memoryBriefPath: string;
    memoryBriefJsonPath: string;
    repositoryFactGraphPath: string;
    scopeMemoryDir?: string;
  };
  scopeMemoryMatches?: Array<{
    scope: string;
    kind: string;
    text: string;
    score: number;
    evidenceRefs: string[];
  }>;
  memoryMatches: Array<{
    kind: string;
    text: string;
    score: number;
  }>;
  nodeMatches: Array<{
    id: string;
    kind: RepositoryFactGraphNodeKind;
    label: string;
    score: number;
    attributes?: Record<string, string | number | boolean>;
  }>;
  edgeMatches: Array<{
    kind: RepositoryFactGraphEdgeKind;
    from: string;
    to: string;
    evidencePath?: string;
    line?: number;
    score: number;
  }>;
  evidenceRefs: string[];
  unknowns: string[];
}

export interface RunbookStep {
  id: string;
  title: string;
  status: "pending" | "ready" | "blocked" | "done";
  command: string;
  rationale: string;
  cheap: boolean;
  usesModel: boolean;
  evidence: string[];
}

export interface RunbookResult {
  context: ProjectContext;
  intent: string;
  generatedAt: string;
  reportPath: string;
  memoryPath: string;
  executiveSummary: ExecutiveSummaryResult;
  steps: RunbookStep[];
}

export interface HarnessAuditCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  evidence: string[];
  recommendation?: string;
}

export interface HarnessAuditMemoryLayer {
  id: string;
  label: string;
  status: "ready" | "partial" | "missing";
  tokenCost: "low" | "medium" | "high";
  artifacts: string[];
  purpose: string;
}

export interface HarnessAuditResult {
  context: ProjectContext;
  generatedAt: string;
  reportPath: string;
  memoryPath: string;
  score: number;
  tokenRisk: "low" | "medium" | "high";
  memoryReadiness: MemoryReadinessResult;
  checks: HarnessAuditCheck[];
  memoryLayers: HarnessAuditMemoryLayer[];
  suggestedCommands: string[];
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
  reportQualityPath?: string;
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
