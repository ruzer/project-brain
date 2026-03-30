# Evolution Plan

# PROJECT-BRAIN v2

## Design goal

Turn `project-brain` from a governed analysis pipeline into a safe autonomous improvement system that can:

- detect issues
- propose changes
- generate patches in isolation
- validate them automatically
- learn from accepted and rejected outcomes
- evolve agent behavior over time without losing control

## Guiding principle

Do not jump directly from report generation to unrestricted autonomy.

The realistic path is:

1. make orchestration explicit
2. make memory actionable
3. make proposals executable in sandboxes
4. make validation mandatory
5. make learning outcome-driven
6. only then allow bounded autonomous improvement

## v2 target architecture

### 1. Split the runtime into control plane and execution plane

Create explicit services instead of one large governance runtime.

Control plane:

- `CycleCoordinator`
- `PolicyEngine`
- `AgentRegistry`
- `TaskPlanner`
- `EvaluationEngine`
- `MemoryService`
- `TelemetryService`

Execution plane:

- `DiscoveryWorker`
- `AgentRunner`
- `PatchRunner`
- `ValidationRunner`
- `RepoSandboxManager`

Why:

The current `AgentSelfGovernanceSystem` mixes planning, execution, scoring, learning, proposal rendering, and persistence. That centralization is already a bottleneck.

### 2. Replace static agent classes with manifest-driven agents

Each agent should declare a manifest containing:

- `agentId`
- version
- supported languages and repo types
- trigger policies
- required memory views
- required tools
- output schema
- safety classification
- evaluation rubric

Keep a narrow runtime contract:

- `prepare()`
- `analyze()`
- `propose()`
- `review()`
- `learn()`

Why:

This removes governance hardcoding from the central runtime and lets new agents plug in without editing priority matrices and helper switches everywhere.

### 3. Introduce typed shared state instead of markdown-only coordination

Use a shared cycle state object with schemas for:

- discovery facts
- repository map
- issue hypotheses
- ranked risks
- candidate proposals
- validation jobs
- human decisions
- outcome records

Keep markdown as an output artifact, not as the system's primary internal state.

Why:

Right now agents mostly exchange text and the system mostly persists text. That prevents strong planning and validation loops.

### 4. Build a real memory architecture

#### Episodic memory

Store every cycle as a structured episode:

- repo snapshot hash
- trigger
- agents run
- issues found
- proposals generated
- approvals
- patches attempted
- validations passed or failed
- final outcome

#### Semantic memory

Add a retrievable knowledge layer keyed by:

- stack
- framework
- issue pattern
- module type
- repository class

This can be a vector-backed or embedding-backed store later, but v2 only needs a retrieval abstraction.

#### Outcome memory

Track what actually happened after proposals:

- accepted
- rejected
- false positive
- patch failed tests
- patch regressed behavior
- patch reduced incident count

#### Agent memory

Keep per-agent behavior histories:

- precision by issue class
- acceptance rate by proposal type
- validation success rate
- false-positive clusters
- best-performing heuristics by repo archetype

Why:

Without outcome-linked memory, the system cannot improve agent quality in a meaningful way.

### 5. Add a real self-improvement loop for agents

This loop must target agent behavior, not just repository code.

For each agent:

1. collect validated outcomes from previous runs
2. identify failure patterns such as false positives, missed issues, or low-value proposals
3. generate candidate heuristic or prompt revisions in a sandbox branch of the agent configuration, not the target repository
4. replay the agent against benchmark repositories and historical episodes
5. compare precision, recall proxy metrics, approval rate, and validation pass rate
6. promote the new agent version only if it beats the current version under policy constraints

Outputs needed:

- agent version registry
- benchmark suite
- evaluation harness
- rollout policy
- rollback path

Why:

This is the missing capability that separates a static analyzer from an evolving autonomous system.

### 6. Add bounded LLM integration where it matters

Current v1 has no LLM layer. v2 should introduce one carefully.

Use LLMs for:

- hypothesis generation from discovery and code evidence
- patch planning
- proposal summarization
- risk explanation
- postmortem synthesis
- agent self-improvement proposal drafting

Do not use LLMs for:

- unconstrained repository writes
- final approval decisions
- validation truth

LLM outputs must always be grounded by:

- repository facts
- tool outputs
- diff context
- validation results
- policy rules

Recommended runtime pattern:

- deterministic tools first
- LLM planning second
- validation tools last
- policy gate before any patch promotion

Why:

The current system's heuristics are too weak for a true engineering agent, but unrestricted LLM execution would be unsafe and noisy.

### 7. Add a repository sandbox and patch validation pipeline

To become an improvement engine, v2 needs a safe execution path:

1. create isolated working copy or ephemeral branch
2. generate patch candidate
3. run repository-specific validations
4. record exact command outputs and diff summary
5. classify result
6. only surface successful candidates for human review or bounded auto-merge policy

Validation gates should include:

- build
- typecheck
- tests
- linters
- smoke checks
- security checks where relevant

Why:

Without a patch-validation loop, the system cannot progress beyond recommendations.

### 8. Replace message logging with an event bus

Messages should become actionable events with subscribers.

Examples:

- `IssueDetected`
- `ProposalCreated`
- `ValidationRequested`
- `ValidationFailed`
- `HumanApproved`
- `FalsePositiveConfirmed`
- `AgentVersionPromoted`

Agents and services should be able to subscribe to those events and react in later phases of the same cycle or in future cycles.

Why:

The current message center records narrative communication, but nothing consumes it.

### 9. Make scheduling real

Add a scheduler service that persists:

- cycle definitions
- repository subscriptions
- next run time
- retry policy
- cooldown windows
- suppression rules
- concurrency limits

Supported schedules should include:

- repository-change hooks
- daily hygiene scans
- weekly architecture reviews
- incident-triggered deep dives
- post-merge validation sweeps

Why:

The current scheduler only selects agents after a run has already been triggered.

### 10. Strengthen governance into policy-as-code

Move from keyword heuristics to explicit policy rules:

- which repos allow autonomous patch generation
- which directories are writable
- which agents can propose code vs docs vs tests
- required validations by proposal type
- required human approval by risk class
- promotion rules for agent-version changes

Add immutable audit artifacts:

- proposal record
- diff record
- validation record
- approval record
- rollback record

Why:

A true autonomous engineering system needs enforceable policy, not just descriptive safety text.

## Proposed v2 phases

## Phase 1: Stabilize v1 into a trustworthy control plane

Ship first:

- isolate cycle state per run
- eliminate supervisor execution-record leakage
- make proposal history append-only
- make task board historical instead of overwrite-only
- turn messages into typed events even before full subscriptions
- make workspace discovery monorepo-aware
- remove dead runtime abstractions or wire them properly

Success criteria:

- clean per-cycle metrics
- repeatable historical audit trail
- accurate repository targeting
- no stale architectural abstractions in docs vs runtime

## Phase 2: Introduce structured memory and evaluation

Ship next:

- episodic cycle store
- proposal outcome store
- per-agent quality metrics
- benchmark repositories for agent regression tests
- validation corpus for false-positive and missed-issue tracking

Success criteria:

- agent quality can be measured over time
- historical outcomes are queryable
- learnings become operational inputs, not just records

## Phase 3: Add sandboxed patch generation

Ship next:

- patch planner
- sandbox working copies
- validation runner
- result classifier
- diff artifact storage

Success criteria:

- system can produce validated candidate changes safely
- failed patches do not contaminate repo state
- successful candidates are grounded by tool-based evidence

## Phase 4: Add bounded autonomous improvement

Ship next:

- repo-level autonomy policies
- low-risk autopilot for docs/tests/config-only scopes
- human-required review for medium and high risk
- automatic rollback from failed post-merge signals

Success criteria:

- real improvements can be made continuously in development environments
- governance remains enforceable
- outcome learning improves future patch precision

## Phase 5: Add agent self-evolution

Ship last:

- agent version registry
- evaluation harness for agent revisions
- replay engine over historical episodes
- promotion and rollback rules for agent versions

Success criteria:

- agents improve based on validated outcomes
- regressions in agent quality are measurable and reversible
- the platform evolves itself under control

## PROJECT-BRAIN v2 reference architecture

Suggested top-level modules:

- `runtime/`
- `policy/`
- `events/`
- `agents/`
- `memory/episodes/`
- `memory/outcomes/`
- `memory/retrieval/`
- `execution/sandbox/`
- `execution/validation/`
- `evaluation/`
- `benchmarks/`
- `integrations/repository/`
- `integrations/models/`

## What must remain from v1

Keep these v1 strengths:

- non-destructive default posture
- filesystem-readable artifacts
- trigger-based execution model
- clear agent descriptors
- useful repository discovery baseline
- strong static-analysis orientation in DevAgent
- simple CLI entrypoints

## What must be removed or demoted

- reliance on markdown as internal state
- hardcoded agent IDs across governance logic
- single giant governance runtime class
- pseudo-communication with no consumers
- synthetic learning outcomes as if they were validated truth
- stale abstractions such as unused coordinator layers

## Final recommendation

Do not market v1 as an autonomous improvement engine.

Ship v2 in two labels:

- `project-brain analyze`: stable analyzer mode
- `project-brain improve`: sandboxed autonomous improvement mode, only after Phases 1 through 4 are complete

That keeps the architecture honest and gives the system a realistic path from analysis tooling to autonomous engineering.
