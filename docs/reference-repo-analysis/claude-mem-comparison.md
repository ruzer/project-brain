# Claude Mem comparison for project-brain

## Purpose

This note captures what `project-brain` should learn from [`claude-mem`](https://github.com/thedotmack/claude-mem) without importing its product assumptions wholesale.

`claude-mem` is primarily a persistent memory system for AI coding assistants. `project-brain` is a repository intelligence engine focused on safe analysis, persisted context, and review-only outputs. The overlap is real, but the product center of gravity is different.

## Product difference

### claude-mem

- preserves context across sessions
- captures observations during assistant use
- summarizes and retrieves prior context
- optimizes continuity for future interactive sessions

### project-brain

- analyzes repositories and codebases
- produces governed context and reports
- persists analysis artifacts for later reuse
- remains review-only and non-destructive by default

## What is worth importing

### 1. Structured fact storage

The strongest transferable idea is not "memory" in the abstract. It is storing small, attributable observations before synthesis.

For `project-brain`, this supports the fact-based roadmap directly:

- `verified_facts`
- `unknowns`
- `evidence_refs`

Recommended direction:

- add a compact fact store for extracted observations
- persist facts before writing executive or synthesis reports
- keep every fact tied to concrete evidence

### 2. Relevance-based retrieval

`claude-mem` emphasizes retrieving context by relevance instead of only by recency. That pattern is useful for `project-brain` in bounded form.

Recommended direction:

- use relevant retrieval during `resume`
- use relevant retrieval during final synthesis
- avoid injecting broad historical context into every step

This should stay optional and scoped to persisted analysis artifacts, not generalized conversation history.

### 3. Operational status discipline

`claude-mem` treats runtime health as a first-class concern. `project-brain` should strengthen the same area for analysis runs.

Recommended direction:

- expose active and completed run state clearly
- surface stale artifacts
- surface missing module outputs
- surface context quality status
- surface degraded or skipped subsystems explicitly

### 4. Explicit run identity

`claude-mem` benefits from a disciplined session model. `project-brain` should formalize run and artifact identity more clearly.

Recommended direction:

- `analysis_run_id`
- `module_run_id`
- `resume_checkpoint`
- `artifact_version`

This makes resume, merge, and artifact replacement easier to reason about.

### 5. Graceful degradation

If a non-critical subsystem fails, the primary workflow should continue with a visible degraded status. That pattern transfers cleanly.

Recommended direction:

- do not block analysis if retrieval fails
- do not block reporting if enrichment fails
- mark outputs as degraded when supporting subsystems are unavailable

## What should not be imported directly

### 1. Permanent daemon architecture

`claude-mem` uses a worker service, local web viewer, persistent background behavior, and a broader operational footprint. That makes sense for a memory product.

For `project-brain`, adopting a daemon-first architecture now would add complexity without improving the core analysis workflow enough to justify the cost.

### 2. Host-hook dependency

`claude-mem` is designed around assistant lifecycle hooks and plugin integration. `project-brain` should remain host-agnostic and usable as a direct CLI analysis engine.

### 3. Broad conversational memory

`claude-mem` captures assistant observations across interactive work. `project-brain` should stay narrower:

- remember repository facts
- remember analysis artifacts
- remember run state

It should not evolve into a general conversation memory layer by default.

### 4. Heavy memory infrastructure too early

Vector databases, always-on services, and multi-component memory infrastructure may be justified later, but they should not be the first move.

Start with simpler building blocks first:

- structured JSON artifacts
- stable artifact schemas
- optional local indexing
- explicit retrieval points

## Recommended adoption path

### Phase 1

- add structured fact storage
- strengthen synthesis to consume facts instead of freeform summaries
- add context quality reporting
- strengthen `status` with run and artifact health

### Phase 2

- add optional relevance-based retrieval over persisted facts
- use retrieval in `resume` and final synthesis
- formalize run identity and artifact versioning

### Phase 3

- evaluate a lightweight persistent index if retrieval quality or scale requires it
- keep heavy background infrastructure optional, not foundational

## Alignment with current project-brain principles

These imports are consistent with current repository principles:

- analysis-first
- governed outputs
- bounded execution
- review-only recommendations
- cheap/local-first execution where possible

They are not a justification to convert `project-brain` into an autonomous memory platform.

## Bottom line

`claude-mem` is useful as a source of patterns, not as a target architecture.

The most valuable ideas to adopt are:

1. structured fact storage
2. relevance-based retrieval
3. stronger runtime and artifact health visibility
4. explicit run identity
5. graceful degradation

The wrong move would be to copy the daemon, hook, and generalized memory model into the center of `project-brain`.
