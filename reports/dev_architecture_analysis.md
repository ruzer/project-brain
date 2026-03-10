# Dev Architecture Analysis

## Summary

53 modules were analyzed with dependency-cruiser, ts-prune, and ESLint. The dependency graph has 53 local nodes and 87 local edges, with a coupling index of 3.28.

## Structural Metrics

- Number of modules: 53
- Dependency graph: 53 local nodes / 87 local edges
- Coupling index: 3.28
- Circular dependencies: 0
- Unused exports: 16
- Largest modules over 500 lines: 0

## Top 10 Architecture Risks

### 1. [HIGH] Isolate self-governance-system.ts responsibilities

- Problem: governance/self-governance-system.ts combines 377 lines with a coupling score of 11, making it a high-friction change hotspot.
- Affected files: governance/self-governance-system.ts
- Suggested change: Split planning, execution, persistence, and report rendering responsibilities into narrower services with explicit interfaces.
- Estimated difficulty: high
- Confidence: 0.9

### 2. [MEDIUM] Prune unused public exports

- Problem: ts-prune reported 17 unused export(s), which increases public API surface without delivering value.
- Affected files: governance/autonomous-scheduler.ts, orchestrator/chief-agent.ts, orchestrator/main.ts, orchestrator/scheduler.ts, shared/fs-utils.ts, shared/types.ts
- Suggested change: Remove compatibility re-exports that are no longer consumed, or document them as intentional public API contracts.
- Estimated difficulty: low
- Confidence: 0.86

### 3. [MEDIUM] Extract repeated agent analysis scaffolding

- Problem: The duplication scan found 9 modules repeating the same evaluation skeleton, which will make agent behavior harder to evolve consistently.
- Affected files: agents/architecture_agent/index.ts, agents/dependency_agent/index.ts, agents/legal_agent/index.ts, agents/observability_agent/index.ts, agents/optimization_agent/index.ts, agents/product_agent/index.ts, agents/product_owner_agent/index.ts, agents/qa_agent/index.ts, agents/security_agent/index.ts
- Suggested change: Move repeated findings/recommendations setup into shared helper utilities or richer base-agent primitives before adding more specialist heuristics.
- Estimated difficulty: medium
- Confidence: 0.82

### 4. [MEDIUM] Isolate main.ts responsibilities

- Problem: core/orchestrator/main.ts combines 159 lines with a coupling score of 10, making it a high-friction change hotspot.
- Affected files: core/orchestrator/main.ts
- Suggested change: Split planning, execution, persistence, and report rendering responsibilities into narrower services with explicit interfaces.
- Estimated difficulty: medium
- Confidence: 0.78

### 5. [MEDIUM] Add explicit runtime error boundaries

- Problem: Several high-signal modules perform async or file-system work without visible try/catch or promise error boundaries.
- Affected files: agents/dev_agent/index.ts, analysis/dependency_scanner/index.ts, core/orchestrator/main.ts, memory/context_store/index.ts
- Suggested change: Wrap repository IO, manifest parsing, and orchestration transitions in explicit error boundaries that preserve context and failure cause.
- Estimated difficulty: medium
- Confidence: 0.77

### 6. [MEDIUM] Instrument key runtime boundaries with structured logs

- Problem: Critical runtime modules with high fan-in or fan-out still operate without structured logging, reducing diagnosability during continuous analysis.
- Affected files: analysis/api_scanner/index.ts, analysis/dependency_scanner/index.ts, memory/context_store/index.ts, tools/openapi_tools/index.ts
- Suggested change: Add structured lifecycle logs around discovery, parsing, message coordination, and persistence boundaries so failures can be traced by cycle and module.
- Estimated difficulty: low
- Confidence: 0.74

## Refactoring Suggestions

- Isolate self-governance-system.ts responsibilities -> Split planning, execution, persistence, and report rendering responsibilities into narrower services with explicit interfaces. (files: governance/self-governance-system.ts; difficulty: high; confidence: 0.9)
- Prune unused public exports -> Remove compatibility re-exports that are no longer consumed, or document them as intentional public API contracts. (files: governance/autonomous-scheduler.ts, orchestrator/chief-agent.ts, orchestrator/main.ts, orchestrator/scheduler.ts, shared/fs-utils.ts, shared/types.ts; difficulty: low; confidence: 0.86)
- Extract repeated agent analysis scaffolding -> Move repeated findings/recommendations setup into shared helper utilities or richer base-agent primitives before adding more specialist heuristics. (files: agents/architecture_agent/index.ts, agents/dependency_agent/index.ts, agents/legal_agent/index.ts, agents/observability_agent/index.ts, agents/optimization_agent/index.ts, agents/product_agent/index.ts, agents/product_owner_agent/index.ts, agents/qa_agent/index.ts, agents/security_agent/index.ts; difficulty: medium; confidence: 0.82)
- Isolate main.ts responsibilities -> Split planning, execution, persistence, and report rendering responsibilities into narrower services with explicit interfaces. (files: core/orchestrator/main.ts; difficulty: medium; confidence: 0.78)
- Add explicit runtime error boundaries -> Wrap repository IO, manifest parsing, and orchestration transitions in explicit error boundaries that preserve context and failure cause. (files: agents/dev_agent/index.ts, analysis/dependency_scanner/index.ts, core/orchestrator/main.ts, memory/context_store/index.ts; difficulty: medium; confidence: 0.77)

## Modules With Highest Complexity

- shared/fs-utils.ts (118 lines, coupling 20, complexity 33.93, change 83 via coupling-size-proxy)
- agents/product_owner_agent/index.ts (44 lines, coupling 2, complexity 29.47, change 43 via coupling-size-proxy)
- agents/product_agent/index.ts (44 lines, coupling 1, complexity 27.97, change 39 via coupling-size-proxy)
- agents/base-agent.ts (58 lines, coupling 13, complexity 24.93, change 58 via coupling-size-proxy)
- governance/self-governance-system.ts (377 lines, coupling 11, complexity 24.07, change 44 via coupling-size-proxy)

## Modules Recommended For Isolation

- shared/fs-utils.ts (118 lines, coupling 20, complexity 33.93, change 83 via coupling-size-proxy)
- agents/catalog.ts (123 lines, coupling 12, complexity 17.1, change 42 via coupling-size-proxy)
- governance/self-governance-system.ts (377 lines, coupling 11, complexity 24.07, change 44 via coupling-size-proxy)
- core/orchestrator/main.ts (159 lines, coupling 10, complexity 16.3, change 36 via coupling-size-proxy)
- tools/dev_analysis_tools/index.ts (353 lines, coupling 4, complexity 20.27, change 22 via coupling-size-proxy)

## Architectural Observations

- The local dependency graph is currently acyclic; the main maintainability risk is centralization in a few runtime hubs, not dependency loops.
- governance/self-governance-system.ts (377 lines, coupling 11), core/orchestrator/main.ts (159 lines, coupling 10) currently dominate orchestration and state flow.
- Git history was not available, so change hotspots were approximated from coupling, file size, and duplicate blocks.

## Static Analysis Snapshot

- dependency-cruiser: dependency-cruiser completed successfully.
- ts-prune: ts-prune completed successfully.
- ESLint: ESLint completed successfully.
- Circular dependency paths: None
- Largest modules: governance/self-governance-system.ts (377 lines), tools/dev_analysis_tools/index.ts (353 lines), memory/context_store/index.ts (350 lines), shared/types.ts (253 lines), tools/dev_analysis_tools/contracts.ts (205 lines)
- Highest change hotspots: shared/fs-utils.ts (83), agents/base-agent.ts (58), governance/self-governance-system.ts (44), agents/product_owner_agent/index.ts (43), agents/catalog.ts (42)
- Missing logging candidates: memory/context_store/index.ts, analysis/api_scanner/index.ts, tools/openapi_tools/index.ts, analysis/dependency_scanner/index.ts, governance/message-center.ts
- Missing error handling candidates: memory/context_store/index.ts, analysis/dependency_scanner/index.ts, core/orchestrator/main.ts, agents/dev_agent/index.ts, governance/message-center.ts
- Unused exports: governance/autonomous-scheduler.ts -> ScheduledCycle (used in module), orchestrator/chief-agent.ts -> ChiefAgent, orchestrator/main.ts -> ProjectBrainOrchestrator, orchestrator/scheduler.ts -> WeeklyScheduler, shared/fs-utils.ts -> relativeTo, shared/types.ts -> AgentAction (used in module), shared/types.ts -> AgentMessageType (used in module), shared/types.ts -> TaskState (used in module), shared/types.ts -> ProposalStatus (used in module), shared/types.ts -> RepoStructure (used in module), memory/context_store/index.ts -> readExistingTasks, tools/dev_analysis_tools/contracts.ts -> SOURCE_EXTENSIONS (used in module), tools/dev_analysis_tools/contracts.ts -> IGNORED_PREFIXES (used in module), tools/dev_analysis_tools/contracts.ts -> DependencyCruiserDependency (used in module), tools/dev_analysis_tools/contracts.ts -> EslintMessage (used in module), agents/product_agent/index.ts -> ProductAgent
