# DECISIONS

- Adopt non-destructive analysis as the operating mode.

## 2026-05-13

- Preserve bounded swarm behavior while refactoring internals through pure helper modules with direct tests.
- Keep `core/swarm_runtime/index.ts` as the public entrypoint and re-export existing budgeting APIs for compatibility.
- Do not mix runtime extraction with behavior changes; each split must pass focused swarm tests and the full suite.
