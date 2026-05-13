# ARCHITECTURE_MAP

## Top-level directories

- .agents
- .eslint.devagent.config.mjs
- .github
- .gitignore
- ACKNOWLEDGEMENTS.md
- agents
- AI_CONTEXT
- analysis
- CITATION.cff
- cli
- CODE_OF_CONDUCT.md
- config
- CONTRIBUTING.md
- core
- docs
- eslint.config.mjs
- governance
- integrations
- LICENSE
- memory
- orchestrator
- package-lock.json
- package.json
- planning
- prompts
- README.md
- reports
- scripts
- SECURITY.md
- shared
- SUPPORT.md
- tests
- tools
- tsconfig.json
- vitest.config.ts

## Structure signals

- Source files: 125
- Test files: 40
- Nested subrepos: 0
- Git submodules: 0

## Runtime hints

- Frameworks: Unknown
- Infrastructure: Not detected
- CI providers: GitHub Actions
- Logging: Not detected
- Metrics: Not detected

## Swarm runtime modules

- `core/swarm_runtime/index.ts`: bounded swarm orchestration entrypoint, task execution, scope chunking, prompts, persistence, and report assembly.
- `core/swarm_runtime/output_normalizer.ts`: planner fallback, planner task normalization, worker output normalization, synthesis normalization, markdown section salvage, and code-only response quarantine.
- `core/swarm_runtime/resource_budget.ts`: recommended chunk size, parallelism, resilience defaults, resource pressure, adaptive queue budget, split group sizing, and local-budget mode detection.

## Current hotspots

- `core/swarm_runtime/index.ts`: 1677 lines after first extraction; still contains cache, learning, scope chunking, prompt construction, and report rendering responsibilities.
- `core/orchestrator/main.ts`: 1779 lines; still a high-friction command orchestration hotspot.
- `governance/self-governance-system.ts`: 785 lines; still a candidate for later responsibility split.
