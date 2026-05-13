# TASKS

## Active 2026-05-13

- Extract swarm cache handling from `core/swarm_runtime/index.ts` into a focused helper with cache-key and pruning tests.
- Extract swarm scope learning and memory-reduction helpers into a focused helper with unit tests.
- Extract `renderSwarmReport` into a report writer module and preserve existing markdown output through snapshot-like assertions.
- Continue reducing `core/swarm_runtime/index.ts` before starting the larger `core/orchestrator/main.ts` split.
