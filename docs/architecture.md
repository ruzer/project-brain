# project-brain architecture

`project-brain` is organized as a pipeline:

1. `DiscoveryEngine` scans the repository and normalizes raw signals.
2. `ContextBuilder` converts those signals into persistent project memory.
3. `ChiefAgent` coordinates specialized agents.
4. The orchestrator aggregates findings into weekly and risk reports.

Core modules:

- `analysis/*`: low-level scanners for repository structure, dependencies, APIs, and infrastructure
- `integrations/*`: adapters for git, CI, logging, and metrics signals
- `memory/*`: persistence for `AI_CONTEXT`, errors, decisions, tasks, and learnings
- `agents/*`: domain-specific evaluation and report generation
- `core/orchestrator/*`: end-to-end coordination and weekly scheduling helpers

The system is intentionally non-destructive. It analyzes, documents, and recommends, but it does not apply fixes to the target repository.
