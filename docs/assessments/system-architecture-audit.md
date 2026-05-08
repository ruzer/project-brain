# System Architecture Audit

## Executive verdict

The implemented system is not a true autonomous agent platform. It is a non-destructive repository analysis pipeline with a governed agent catalog layered on top.

The real runtime shape is:

CLI -> `ProjectBrainOrchestrator` -> `DiscoveryEngine` -> `ContextBuilder` -> `AgentSelfGovernanceSystem` -> reports, proposals, task files, learnings, telemetry.

That is a batch pipeline, not an adaptive autonomous improvement engine.

## What the system actually is

The implementation follows a staged pipeline pattern with artifact persistence:

1. The CLI creates a single `ProjectBrainOrchestrator` instance and routes `init`, `analyze`, `agents`, `weekly`, `report`, and `feedback` into it.
2. The orchestrator runs repository discovery and builds a `ProjectContext` rooted in generated filesystem output.
3. The governance runtime selects agents from a static catalog, creates one task per selected agent, runs them, scores their outputs, generates proposal markdown, persists task/message/learning files, and writes summary reports.
4. Telemetry and runtime observability are written as JSON and markdown artifacts.

This is materially different from the documented story that a `ChiefAgent` coordinates the system. The code path used by the CLI goes directly into `AgentSelfGovernanceSystem`; the `ChiefAgent` class exists but is not part of the actual runtime path.

## Real design pattern

The implemented design is best described as:

- batch analysis pipeline
- static plugin catalog
- heuristic scanner suite
- governance wrapper around report generation
- filesystem-backed memory and telemetry

It is not:

- a blackboard multi-agent system
- an event-driven autonomous controller
- a continuously scheduled improvement daemon
- a self-modifying agent runtime

## Runtime flow

### 1. CLI entrypoints

`cli/project-brain.ts` is the only real entry surface. The CLI resolves the target path, output path, and trigger, then forwards to the orchestrator.

Important observations:

- The CLI is thin and mostly correct.
- The `feedback` command is the only human-in-the-loop mutation path.
- Trigger handling is not fully faithful: `security-advisory` is aliased to `security-audit`, so the dedicated advisory trigger cannot actually be invoked from the CLI.

### 2. Central orchestrator

`core/orchestrator/main.ts` is the real control plane.

Responsibilities:

- create cycle IDs and log context
- run discovery
- build persistent project context
- invoke self-governance
- append memory artifacts
- append learning artifacts
- write weekly and risk reports
- emit telemetry and runtime observability
- aggregate workspace results into ecosystem artifacts

There is exactly one central orchestrator. All execution funnels through it.

### 3. Discovery and context build

`DiscoveryEngine` composes several scanners:

- repository structure scanner
- dependency scanner
- API scanner
- infrastructure scanner
- CI detector
- git detector
- logging detector
- metrics detector

`ContextBuilder` then turns discovery output into a `ProjectContext` plus generated directories:

- `AI_CONTEXT/`
- `reports/`
- `docs/`
- `memory/learnings/`
- `tasks/`
- `docs/proposals/`

The context object passed to agents is mostly a repository snapshot plus output directories. It does not contain prior learnings, scored proposals, or any live inter-agent state.

### 4. Governance runtime

`AgentSelfGovernanceSystem` is the actual execution engine.

Its cycle is:

1. register all agents from a static catalog
2. load prior learning records from `memory/learnings/index.json`
3. select agents for the trigger
4. plan one task per agent
5. persist backlog files and seed synthetic messages
6. run each agent sequentially
7. score outputs
8. classify proposals
9. derive synthetic learning records
10. persist task/message/learning/report artifacts

This is a governance shell around a report pipeline, not a real agent society.

### 5. Workspace mode

Workspace handling exists, but it is narrower than it first appears.

The orchestrator calls `discoverRepositoryTargets()`. If the root path itself looks like a repository, the system immediately treats it as a single target. That means a normal monorepo root with `.git` or `package.json` is not expanded into package-level analysis. Workspace mode only activates when the root directory is a container of sibling repositories.

That is ecosystem discovery, not true monorepo discovery.

## Agent architecture in practice

Agents are implemented as subclasses of `BaseAgent`.

What they share:

- one `evaluate(context)` contract
- one markdown report output contract
- access to the same `ProjectContext`

What they do not have:

- independent memory
- event subscriptions
- message consumption
- tool planning
- model-backed reasoning
- mutation rights

Most agents are simple rule sets over `context.discovery`. `DevAgent` is the exception: it runs dependency-cruiser, ts-prune, ESLint, snapshot analysis, and git-history heuristics to produce a deeper architecture report.

So the system is not “many intelligent agents”. It is “many report generators” plus one stronger static-analysis agent.

## Memory architecture

There are two very different memory layers.

### AI context memory

`memory/context_store/index.ts` writes markdown summaries such as:

- `PROJECT_MODEL.md`
- `ARCHITECTURE_MAP.md`
- `API_MAP.md`
- `DEPENDENCY_GRAPH.md`
- `STACK_PROFILE.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `TASKS.md`
- `LEARNINGS.md`
- `ERRORS.md`

This is mostly durable documentation plus append-only logs.

### Learning memory

`memory/learnings/index.ts` stores JSON `LearningRecord` objects with:

- `agentId`
- `taskId`
- `context`
- `detectedProblem`
- `actionTaken`
- `outcome`
- `confidenceScore`
- timestamps

This is the only structured learning store in the system.

### What this memory does not do

It does not:

- feed directly into agent evaluation logic
- alter prompts or heuristics
- support semantic retrieval
- connect outcomes to patches or diffs
- maintain a causal model of what changed and whether it worked

The only implemented behavioral feedback is task prioritization: if prior learnings contain `MISSED_ISSUE` or `FALSE_POSITIVE`, the council can boost an agent from `normal` to `high` priority.

That is weak operational memory, not learning.

## Learning behavior

The project claims learning, but most records are synthetic.

`deriveLearnings()` generates records automatically from the current cycle using report findings and evaluator scores. In practice this means:

- architecture findings create `ARCHITECTURAL_INSIGHT`
- repeated strings create `REPEATED_BUG_PATTERN`
- scores below 0.7 become `MISSED_ISSUE`
- scores at or above 0.7 become `PENDING_REVIEW`

Those outcomes are inferred from internal heuristics, not from validated external results.

Real outcome learning only happens when a human later runs the `feedback` CLI command.

So the architecture has a feedback input, but not a closed learning loop.

## Governance model

The governance layer is conservative in intent.

Implemented protections:

- agents are declared as `analyze`, `propose`, `report` only
- proposals touching sensitive keywords or high risk are routed to `REQUIRES_HUMAN_REVIEW`
- proposal files explicitly state that no code is modified automatically
- feedback can move tasks into `APPROVED`, `REJECTED`, or `ARCHIVED`

Limits of those protections:

- safety is enforced at descriptor level, not through sandboxing or syscall/file policy
- keyword matching is the main approval heuristic
- the system never executes code changes anyway, so governance mostly classifies text artifacts
- there is no real approval workflow beyond file status and manual CLI feedback

This is safe as a recommendation engine, but not yet a governable autonomous executor.

## Observability and telemetry

The system does have observability artifacts:

- structured JSON log events when `--verbose` is enabled
- per-cycle telemetry JSON files
- a generated `runtime_observability.md`
- execution records in governance summaries

But the implementation is coarse:

- no persisted structured logs unless verbose mode is used interactively
- no per-agent latency breakdowns in telemetry
- no durable failure dashboard
- no tracing, queue metrics, or cycle retry accounting
- risk types are just `high`, `medium`, `low`, not actual categories

There is also a concrete state leak: `AgentSupervisor` keeps execution records on an instance field, and `AgentSelfGovernanceSystem` reuses the same supervisor across runs. Because the orchestrator owns a long-lived governance instance, execution records accumulate between cycles. I verified this by running the same built orchestrator twice against the same fixture: the first run reported 4 execution records and the second reported 8, even though both cycles executed only 4 agents.

That directly weakens telemetry correctness.

## Repository discovery and analysis quality

The discovery stack is practical but mostly heuristic.

Strengths:

- stack-portable manifest parsing across multiple ecosystems
- useful basic signals for CI, APIs, infra, logging, and metrics
- stronger static-analysis path inside `DevAgent`
- ecosystem-level aggregation for sibling repositories

Hard limits:

- file walking stops at 8000 files
- workspace discovery only checks immediate child directories
- monorepo roots are treated as single repositories if they contain `.git` or a manifest
- API, logging, and metrics detection are dependency-name and filename heuristics
- there is no AST-level cross-language semantic model except the TypeScript/JavaScript-heavy DevAgent path

This is enough for broad repository scanning. It is not enough for trustworthy autonomous improvement decisions at scale.

## Does the current architecture support autonomous evolution?

Short answer: no.

It supports:

- detecting issues
- generating recommendations
- scoring agent outputs
- writing proposal artifacts
- storing basic historical records

It does not support:

- modifying repository code autonomously
- testing proposed fixes automatically
- learning from execution outcomes automatically
- revising agent logic or prompts automatically
- promoting successful strategies into new agent behavior
- continuous multi-cycle planning until a goal is satisfied

The phrase “autonomous improvement engine” does not match the implemented behavior.

## CI/CD readiness

For a development environment, the current implementation is reasonably safe to run continuously as an analyzer because it is non-destructive to source code.

Local validation during this audit:

- `npm run build`: passed
- `npm run typecheck`: passed
- `npm test`: passed, including smoke and integration coverage

Operational caveats:

- output is written into the target directory by default, so it still mutates the repository tree with generated artifacts
- proposal directories are cleared and regenerated each cycle, so historical proposal tracking is not durable
- task board files are overwritten with current-cycle state, so this is not a persistent backlog engine
- telemetry can be inflated by leaked execution records across repeated runs

## Bottom line

`project-brain` v1 is a competent governed repository analysis pipeline.

It is not yet an autonomous engineering system.

The strongest implemented ideas are:

- clean end-to-end orchestration
- practical multi-language repository scanning
- non-destructive governance posture
- useful filesystem-based artifacts
- a meaningful DevAgent static-analysis path

The weakest architectural truths are:

- no closed execution loop
- no real learning loop
- no real inter-agent collaboration
- no true scheduler
- no agent self-evolution
- partial modularity only
- state leakage across cycles

## Evidence anchors

Primary implementation files reviewed:

- `cli/project-brain.ts`
- `core/orchestrator/main.ts`
- `core/context_builder/index.ts`
- `core/discovery_engine/index.ts`
- `analysis/workspace_discovery/index.ts`
- `analysis/repo_scanner/index.ts`
- `analysis/dependency_scanner/index.ts`
- `analysis/api_scanner/index.ts`
- `analysis/metrics/metrics_collector.ts`
- `agents/base-agent.ts`
- `agents/catalog.ts`
- `agents/*/index.ts`
- `governance/self-governance-system.ts`
- `governance/agent-registry.ts`
- `governance/agent-council.ts`
- `governance/agent-supervisor.ts`
- `governance/message-center.ts`
- `governance/task-board.ts`
- `memory/context_store/index.ts`
- `memory/learnings/index.ts`
- `memory/learning_store/index.ts`
