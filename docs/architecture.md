# project-brain architecture

## Purpose

`project-brain` is a repository intelligence engine. Its job is to understand software systems, persist analysis context, run specialist agents, and produce safe recommendations for humans or downstream coding agents.

## Runtime flow

```text
CLI -> Orchestrator -> Discovery -> Context Builder -> Agents -> Reports -> Patch Proposals
```

## Main modules

- `cli/`: command entrypoints
- `core/`: orchestration, routing, discovery coordination, and runtime services
- `agents/`: specialist agents such as QA, UX, architecture, optimization, documentation, and development review
- `analysis/`: deterministic scanners and report builders
- `memory/`: AI context, learnings, and persisted cycle artifacts
- `tools/`: helper modules for patch proposal generation and repo-level operations
- `prompts/context_templates/`: reusable context prompts for external project work

## Source layout decision

The repository currently uses top-level runtime directories such as `agents/`, `core/`, `cli/`, and `memory/`.

A physical move into `src/` was intentionally not performed in this baseline because it would require a functional refactor across imports, build configuration, and execution paths. The current layout remains compatible with the existing CLI and build pipeline.

## Safety model

`project-brain` is non-destructive by design.

- target repositories are analyzed, not modified
- generated diffs are review-only
- human approval is required before implementation
- unsafe surfaces must stay blocked from automated proposals

## External repository workflow

For external repositories and similar systems, the normal flow is:

1. run repository analysis
2. generate `AI_CONTEXT`, reports, and implementation tasks
3. export prompt-ready context for a downstream coding agent
4. review proposed diffs before any manual application
