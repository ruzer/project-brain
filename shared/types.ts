export type RiskLevel = "low" | "medium" | "high";
export type AgentAction = "analyze" | "propose" | "report";
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
  filePath: string;
  riskLevel: RiskLevel;
  affectedFiles: string[];
  expectedBenefit: string;
  implementationSketch: string;
  decisionRationale: string;
  sourceReportPath: string;
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
  executionRecords: AgentExecutionRecord[];
  agentActivityReportPath: string;
  improvementReportPath: string;
}

export interface AgentEvaluation {
  title: string;
  summary: string;
  findings: string[];
  recommendations: string[];
  riskLevel: RiskLevel;
  content?: string;
}

export interface ReportManifest {
  memoryFiles: string[];
  reportFiles: string[];
  docFiles: string[];
  learningFiles: string[];
  taskFiles: string[];
  proposalFiles: string[];
  knowledgeFiles?: string[];
}

export interface OrchestrationResult {
  context: ProjectContext;
  agentReports: AgentReport[];
  weeklyReportPath: string;
  riskReportPath: string;
  governanceSummary?: GovernanceSummary;
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
