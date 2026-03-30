---
name: project-brain-maintainer
description: Use when working inside the project-brain repository to improve, debug, or extend the bounded swarm runtime, deepagents engine, AI router, CLI flows, memory artifacts, governance pipeline, or repo-specific maintenance workflows. Applies to tasks about token usage, task scheduling, provider routing, resume/ask continuity, review-only safeguards, and runtime verification in this repo.
---

# Project Brain Maintainer

Use this skill only inside the `project-brain` repository.

## Core invariants

- Keep `project-brain` analysis-first and review-only by default.
- Preserve the governed pipeline: discovery -> context -> firewall -> governance -> memory -> reports.
- Treat `deepagents` as experimental; do not replace the bounded swarm wholesale unless the user explicitly asks for that direction.
- Prefer cheap/local execution for broad scans and reserve expensive/cloud execution for planning, synthesis, or clearly accuracy-sensitive work.

## Primary files

- CLI entrypoint: `cli/project-brain.ts`
- Main orchestrator: `core/orchestrator/main.ts`
- Bounded swarm runtime: `core/swarm_runtime/index.ts`
- Experimental deepagents engine: `core/deepagents_swarm/index.ts`
- AI router: `core/ai_router/router.ts`
- Resume and status recovery: `core/resume/index.ts`, `core/status/index.ts`
- Runtime memory and artifacts: `AI_CONTEXT/`, `memory/`, `reports/`
- Governance layer: `governance/`, `docs/agent-self-governance.md`

## Task routing

### Swarm runtime work

If the task touches swarm economics, scope chunking, retries, cache, learning, or delegation:

1. Read `core/swarm_runtime/index.ts`.
2. Read `shared/types.ts`.
3. Read `tests/integration/swarm-runtime.test.ts`.
4. Preserve bounded execution, explicit budgets, and persisted artifacts under `memory/swarm/` and `reports/swarm_run.md`.

### Provider or model routing work

If the task touches provider choice, local/cloud behavior, or cost/residency:

1. Read `core/ai_router/router.ts`.
2. Inspect where `selectModel()` and `ask()` diverge.
3. Keep fallback behavior explicit and observable.
4. Verify that cloud-capable logic does not silently break local-only runs.

### Ask or resume continuity work

If the task touches user continuation, workflow reuse, or saved state:

1. Read `core/orchestrator/main.ts`.
2. Read `core/resume/index.ts`.
3. Read `core/intent_router/index.ts`.
4. Read `tests/integration/ask-intent-routing.test.ts`, `tests/unit/resume.test.ts`, and `tests/unit/status.test.ts`.

### Governance or safety work

If the task touches policy packs, approvals, or agent outputs:

1. Read `governance/`.
2. Read `docs/agent-self-governance.md`.
3. Preserve human-review gates and the firewall boundary.
4. Do not let optimization bypass governance.

## Working rules

- Prefer narrow fixes over broad rewrites.
- Reuse existing artifact paths and report formats instead of creating new top-level outputs.
- When adding memory, prefer compact structured JSON for runtime state and keep human-readable Markdown reports aligned with it.
- When changing planner or worker prompts, update the closest integration tests.
- When changing CLI behavior, keep current commands stable: `ask`, `resume`, `swarm`, `review-delta`, `firewall`, `status`.

## Verification

Run the smallest relevant set first:

- `npm run typecheck`
- `npm test -- --run tests/integration/swarm-runtime.test.ts`
- `npm test -- --run tests/integration/ask-intent-routing.test.ts tests/unit/resume.test.ts tests/unit/status.test.ts`
- `npm run build`

Use broader `npm test` only when the change spans multiple subsystems.

## Avoid

- Do not convert `project-brain` into an autonomous code-writing engine without an explicit product change.
- Do not import external runtimes wholesale when extracting a smaller pattern is enough.
- Do not add heavy memory infrastructure or distributed-worker complexity unless the task explicitly justifies the operational cost.
