# Weak Points

## 1. There is no real learning loop

The system stores learning records, but agents do not consume them during evaluation.

What actually happens:

- previous learnings are loaded by governance
- the council can boost task priority for agents associated with `MISSED_ISSUE` or `FALSE_POSITIVE`
- agents still run against the same `ProjectContext` only
- no heuristic, threshold, prompt, or tool policy changes as a result of those learnings

Consequence:

The architecture remembers outcomes, but it does not improve decision quality from them.

## 2. There is no real autonomous scheduler

`AutonomousScheduler` selects agents for a trigger, but it does not schedule future runs. `describeCycles()` is descriptive metadata, not an active scheduling engine. `WeeklyScheduler` only formats a time window and a suggested next run timestamp.

Consequence:

The system supports repeated manual or externally triggered cycles, not autonomous recurring operation.

## 3. The multi-agent story is overstated

Messages are written, not consumed. Agents do not negotiate, delegate, re-plan, or react to each other during a cycle.

Consequence:

The framework behaves like centralized fan-out/fan-in orchestration, not like a collaborative agent network.

## 4. Governance state leaks across cycles

`AgentSupervisor` stores execution records on an instance field. `AgentSelfGovernanceSystem` keeps one supervisor instance. `ProjectBrainOrchestrator` keeps one self-governance instance.

Consequence:

Execution records accumulate across runs, which corrupts per-cycle metrics and workspace summaries. This is not theoretical; it reproduces in runtime.

## 5. Proposal history is not durable

Proposal directories are cleared and rewritten during initialization and proposal generation.

Consequence:

The system does not maintain a trustworthy historical chain of proposals across cycles. It keeps the latest proposal set, not a proposal ledger.

## 6. Task history is also shallow

The task board persists only the current task snapshot into `backlog.json`, `active.json`, and `completed.json`. Each run replaces those files with the latest state set.

Consequence:

This is not a real backlog engine. Longitudinal planning and auditing are weak.

## 7. Workspace discovery is not monorepo-aware

If the root path itself looks like a repository, the system immediately stops and analyzes it as one target. Workspace mode only activates for directories that contain sibling repositories.

Consequence:

Typical monorepos are treated as single repositories rather than ecosystems of packages or services.

## 8. Repository scanning is capped and heuristic-heavy

The file walker stops at 8000 files. API, logging, metrics, and much of the stack detection are inferred from filenames and dependency names.

Consequence:

Large repositories can be partially scanned without a hard warning, and many findings are only as good as the naming conventions in the repo.

## 9. The architecture is only partially modular

The base agent abstraction is clean, but the governance layer hardcodes agent identities in:

- priority mapping
- documented schedule descriptions
- follow-up routing
- affected-file defaults
- expected-benefit templates

Consequence:

Adding a new agent without changing orchestrator code is possible, but integrating it properly still requires editing multiple governance modules.

## 10. Documentation and runtime have drifted apart

Examples:

- docs and README still present `ChiefAgent` as the coordinator, but the runtime path uses `AgentSelfGovernanceSystem`
- `ProductAgent` exists, but the live catalog uses `ProductOwnerAgent`
- docs describe self-improvement proposal artifacts that are not what the code actually writes
- README points to a CI workflow path that does not match the actual workflow filename

Consequence:

Architectural understanding from documentation is unreliable unless verified against the code.

## 11. Guardrails are declarative, not enforceable runtime policy

The supervisor verifies allowed action labels in agent descriptors and classifies proposals using keyword heuristics.

It does not provide:

- sandboxed execution
- file write restrictions
- branch isolation
- patch validation pipelines
- policy-as-code enforcement beyond string matching

Consequence:

The system is safe today mainly because it does not try to execute changes, not because the governance layer can safely supervise execution.

## 12. Learning outcomes are mostly self-authored

`deriveLearnings()` infers outcomes like `MISSED_ISSUE` and `PENDING_REVIEW` from internal scoring rather than real-world results.

Consequence:

The learning store can accumulate noisy self-judgments that look authoritative but are not grounded in validated outcomes.

## 13. There is no code-change loop

The system never moves from:

issue detection -> patch proposal -> patch generation -> validation -> rollout -> post-change learning

It stops at report and proposal generation.

Consequence:

Calling it an autonomous improvement engine is premature. It is currently an autonomous analysis and recommendation engine.

## 14. Observability is present but shallow

Telemetry tracks cycle duration, counts, and proposal statuses. Structured logs are only emitted in verbose mode. There is no durable log sink, retry telemetry, queue depth, agent runtime breakdown, or failure trend tracking.

Consequence:

The system can be monitored at a coarse level, but diagnosing agent quality drift or orchestration bottlenecks will be hard at scale.

## 15. Trigger support is inconsistent

The CLI converts `security-advisory` into `security-audit`.

Consequence:

The public API exposes more trigger nuance than the runtime actually honors.

## Summary verdict

The biggest structural weaknesses are not cosmetic. They are foundational:

- memory does not drive behavior
- governance does not supervise execution, only text artifacts
- orchestration is single-pass and centrally hardcoded
- agent collaboration is mostly simulated
- state isolation is weak
- scaling model is shallow for monorepos and large repositories

That combination is why the system cannot yet scale into a true autonomous improvement engine.
