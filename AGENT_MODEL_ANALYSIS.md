# Agent Model Analysis

## Executive judgment

The agent model is modular at the class level, but only partially modular at the system level.

A new agent can be added without rewriting the orchestrator itself.
A new agent cannot be added cleanly as a first-class citizen without touching multiple governance heuristics.

That means the framework is extensible, but not cleanly pluggable.

## How agents are defined

Every agent extends `BaseAgent` and implements one method:

- `evaluate(context: ProjectContext): Promise<AgentEvaluation>`

The base class handles:

- logging
- report rendering
- report file writing
- conversion from `AgentEvaluation` to `AgentReport`

This is a good narrow contract.

The problem is that the contract is also very weak:

- agents receive only `ProjectContext`
- they do not receive prior learnings
- they do not receive other agent messages
- they do not receive task metadata beyond what can be inferred from the output files
- they do not expose structured actions, tools, or plans

So the framework supports interchangeable report producers, not autonomous specialists with memory and behavior policies.

## Agent catalog and registration

Registration is static.

`buildAgentCatalog()` constructs the catalog in code and `AgentSelfGovernanceSystem` registers all entries in its constructor.

This provides:

- deterministic startup
- explicit metadata per agent
- trigger routing based on descriptors

But it also means:

- no dynamic agent loading
- no manifest-based plugin discovery
- no runtime capability negotiation
- no hot-swapping of agent versions
- no per-repository agent configuration

The registry itself is simple and clean. The surrounding system is not dynamic.

## Actual agent behavior

### Most agents

Most agents are thin heuristics over `context.discovery`.

Examples:

- `QAAgent` checks testing counts and ratios
- `SecurityAgent` checks risky filenames, lockfiles, and `.dockerignore`
- `ObservabilityAgent` checks whether logging, metrics, and alerts were detected
- `LegalAgent` checks for license and notice files
- `ArchitectureAgent` looks at broad structural signals

These agents are lightweight and easy to understand, but they are not deeply analytical. They do not inspect code semantics, runtime traces, issue trackers, or change history beyond the static discovery snapshot.

### DevAgent

`DevAgent` is materially different. It uses local tooling and file snapshots to build module metrics, coupling analysis, duplication signals, unused exports, missing logging, missing error handling, and architecture risk proposals.

This is the only agent that feels structurally closer to an engineering assistant instead of a checklist rule set.

### DocumentationAgent

`DocumentationAgent` is also special because it writes generated docs to `docs/architecture.md`, `docs/api.md`, and `docs/runbook.md` in addition to its report.

## Are agents independent?

Not really.

They are independent in the narrow sense that each can run by itself against the same `ProjectContext`.

They are not independent in the stronger architectural sense because:

- they all depend on the same discovery snapshot
- they do not own isolated memory
- they do not manage their own tools or plans
- they do not participate in a real event bus
- they do not consume other agents' outputs before producing their own results
- their follow-up routing is hardcoded centrally, not emergent

This is closer to a fan-out report stage than to autonomous cooperating agents.

## Do agents communicate?

Only cosmetically.

`AgentMessageCenter` creates structured messages and persists them to `tasks/messages.json`, but no agent ever consumes that message stream inside the same cycle.

What happens in practice:

- `AgentCouncil` seeds assignment messages
- each agent run generates an `ANALYSIS_RESULT`
- a few hardcoded follow-up messages are emitted for specific agent/risk combinations
- messages are persisted for audit purposes

What does not happen:

- no agent reads inbound messages before acting
- no agent changes its behavior based on those messages
- no negotiation, delegation, or retry occurs
- no downstream agent is re-run after receiving a follow-up

So communication exists as logging, not coordination.

## Can new agents be added without rewriting the orchestrator?

### Narrow answer

Yes.

If you create a new `BaseAgent` subclass and add it to `buildAgentCatalog()`, the orchestrator will run it through the registry-driven governance path without changes to `ProjectBrainOrchestrator`.

### Real answer

Only partially.

To integrate a new agent cleanly, you will usually also need to touch:

- `governance/agent-council.ts` for priority mapping
- `governance/autonomous-scheduler.ts` for documented cycles
- `governance/message-center.ts` for follow-up logic
- `governance/self-governance-system.ts` helper functions such as `defaultAffectedFiles()` and `expectedBenefitFor()`
- maybe proposal safety heuristics if the new agent works in a sensitive area

That is hidden coupling.

So the orchestrator is not the problem. The governance layer is where extensibility becomes brittle.

## Tight-coupling signals

The codebase contains several architecture drift signals around agents:

- `ChiefAgent` still exists as a separate orchestration abstraction, but the runtime path does not use it.
- `ProductAgent` exists as a full class, but the actual catalog registers `ProductOwnerAgent` instead.
- `ProductAgent` and `ProductOwnerAgent` currently duplicate the same logic almost verbatim.
- agent behavior assumptions are embedded in hardcoded agent IDs across governance helpers.

Those are signs that the abstraction boundary has already drifted from the implementation.

## Can agents evolve?

Not in the implemented system.

The framework does not provide:

- prompt versioning
- tool policy versioning
- agent configuration storage
- agent experiment runs
- outcome-linked parameter tuning
- automatic replacement of heuristics
- model selection or model routing

The so-called self-governance layer produces repository improvement proposals, not agent-improvement proposals.

That distinction matters.

The system can say:

- add tests
- improve logging
- write docs
- refactor a hotspot

It cannot say and then apply:

- QAAgent should change its detection heuristic because last 30 approvals showed false positives
- SecurityAgent version 1.1 outperformed 1.0 on validated secrets findings, promote it
- DevAgent should use a different prompt, metric threshold, or toolchain for Java repositories

Without that loop, agents do not evolve.

## Scalability of the agent model

### What scales reasonably well

- adding more simple report-style agents
- running a fixed set of agents against small to medium repositories
- generating more artifact types from the same discovery snapshot

### What does not scale well

- large agent catalogs with differentiated policies
- agents with different memory needs
- agents that require real coordination
- iterative plan/execute/validate loops
- cross-agent negotiation
- heterogeneous execution backends
- cross-repository adaptive specialization

The current design will become governance-heavy and repetitive before it becomes agent-rich.

## Autonomy potential of the current agent model

Current autonomy level:

- autonomous detection: partial
- autonomous prioritization: weak
- autonomous proposal generation: partial
- autonomous execution: none
- autonomous validation: none
- autonomous learning: weak
- autonomous self-modification: none

The model is useful as an analysis swarm. It is not yet a self-improving engineering workforce.

## Bottom line

The agent layer is good enough for a v1 analysis framework.

It is not yet architected for:

- independent agent cognition
- robust inter-agent collaboration
- durable adaptive behavior
- scalable plugin growth
- agent self-evolution

The design choice that limits it most is this: agents are treated as functions from `ProjectContext` to markdown reports, while all meaningful orchestration intelligence remains centralized and hardcoded.

That keeps v1 simple.
It also caps v1 far below a true autonomous improvement engine.
