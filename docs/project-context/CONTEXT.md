# CONTEXT

## Repository Snapshot

- Repository: project-brain
- Target: repository root
- Updated: 2026-05-13
- Languages: TypeScript
- Testing: Vitest
- Current focus: reduce `core/swarm_runtime/index.ts` coupling through narrow, tested module extractions.

## Context Directory Policy

- `docs/project-context/` is curated, versioned project memory for this repository.
- `AI_CONTEXT/` is reserved for generated output layouts and is ignored at the repository root.
- `BRAIN/AI_CONTEXT/` is generated local runtime output because the CLI defaults to `--output ./BRAIN` when no output path is provided.
- `BRAIN/` is ignored by git and may include machine/session-specific artifacts such as `MEMORY_BRIEF.md`, `EXECUTIVE_SUMMARY.md`, `status/`, `swarm/`, and `runbook/`.
- If generated context needs to be refreshed, run the CLI and let it regenerate `BRAIN/AI_CONTEXT/`; update `docs/project-context/` only for durable repo knowledge.

## Current Implementation Context

- `core/swarm_runtime/index.ts` was reduced from 2232 lines to 1677 lines.
- `core/swarm_runtime/output_normalizer.ts` now owns planner, worker, and synthesis output normalization.
- `core/swarm_runtime/resource_budget.ts` now owns parallelism, timeout, resource pressure, and queue budget policy.
- `tests/unit/swarm-output-normalizer.test.ts` covers fallback planner behavior, markdown salvage, code-only output quarantine, synthesis parsing, and unique string handling.

## Verification Snapshot

- `npm run -s typecheck`: passing.
- `npm run -s lint`: passing.
- `npm run -s build`: passing.
- `npm test`: 52 files, 147 tests passing.
