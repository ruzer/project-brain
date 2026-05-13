# LEARNINGS

## 2026-05-13

- First safe `swarm_runtime` split completed: pure output normalization and resource budgeting were extracted without changing the public `runSwarm` contract.
- Direct unit coverage now exists for local-model output normalization, including markdown salvage and code/script-only response quarantine.
- `core/swarm_runtime/index.ts` remains a hotspot at 1677 lines; next low-risk extraction candidates are swarm cache handling, scope learning/memory helpers, and report rendering.
