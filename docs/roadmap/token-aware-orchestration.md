# Token-Aware Orchestration

## Purpose

Make `project-brain` more powerful while spending fewer model tokens.

The core principle is simple: deterministic facts and persisted artifacts should be consulted before broad model analysis. Expensive model calls should be used for synthesis, prioritization, and ambiguous judgment, not for rediscovering repository shape on every run.

## Current useful foundation

`project-brain` already has several building blocks for this:

- `map-codebase` creates a structural repository map.
- `code-graph` creates `memory/code_graph/code_graph_v2.json`.
- `code-graph` also creates `memory/knowledge_graph/repository_fact_graph.json`.
- `initTarget` refreshes `AI_CONTEXT/MEMORY_BRIEF.md` and `memory/memory_brief/memory_brief.json`.
- `status` and `resume` track available artifacts.
- `swarm` has response caching and learned scope boosts.
- `AI_CONTEXT`, `reports`, `docs`, `memory`, and `tasks` give stable artifact locations.

The main gap is orchestration discipline: every workflow should decide what can be answered from existing facts before sending context to a model.

## Recommended execution order

### 1. Bootstrap

Run cheap and deterministic steps first:

```bash
project-brain doctor . --output /path/to/output
project-brain map-codebase . --output /path/to/output
project-brain code-graph . --output /path/to/output
project-brain status . --output /path/to/output
```

### 2. Reuse

Before any broad `swarm`, call:

```bash
project-brain resume . --output /path/to/output
```

The resume path should prefer existing factual artifacts:

- memory brief
- codebase map
- repository fact graph
- previous swarm memory
- improvement plan
- impact radius

### 3. Target

Only after reusable context exists, run bounded model analysis:

```bash
project-brain swarm "<intent>" . --output /path/to/output
```

Use narrow scopes when possible:

- smaller `--chunk-size`
- lower `--max-queued-tasks`
- explicit module paths in the user intent
- local budget mode for quick scans

## Token-saving rules

### Apply one global token policy

All model-facing requests should pass through a small shared token policy before execution. The policy should stay short because it is injected into prompts globally.

The policy should enforce:

- concise structured output
- no repeated prompt text
- no invented paths, APIs, versions, entities, or relationships
- `UNKNOWN` for missing evidence
- smallest useful task set for planners
- deduplication during synthesis

### Prefer facts over summaries

Use structured facts as prompt input:

- memory brief
- file paths
- manifests
- routes
- symbols
- imports
- graph edges
- generated artifact paths

Avoid sending long markdown reports when a compact JSON index can answer the same question.

### Unknown beats guessed

If a relationship is not visible in code, config, schema, or generated artifacts, the system should emit `unknown` or `not verified`.

### Models should synthesize, not rediscover

Broad discovery should be deterministic. Model calls should be reserved for:

- prioritization
- tradeoff explanation
- synthesis across verified facts
- ambiguous architecture review

### Cache only stable prompts

The swarm cache is useful only if prompts are stable. Prompt inputs should depend on:

- git commit
- target path
- selected model
- intent
- compact factual context

Avoid putting volatile timestamps or large markdown blobs into cached prompts.

## Immediate implementation backlog

### Phase 1

- Make `status` and `resume` aware of the repository fact graph.
- Recommend `code-graph` before broad swarm runs.
- Extend swarm worker output with:
  - `verified_facts`
  - `unknowns`
  - `evidence_refs`
- Extend swarm synthesis with the same fact-aware fields.

### Phase 2

- Add a `fact-store` artifact fed by deterministic extractors.
- Add `context_quality_gate` to block low-evidence summaries from becoming canonical.
- Add compact context selection for swarm workers from fact graph and fact store.

### Phase 3

- Add a query command over factual artifacts:
  - `project-brain fact-query`
  - `project-brain graph-query`
- Add optional semantic retrieval over verified facts.
- Use retrieval in `ask`, `resume`, and synthesis before reading large reports.

## Target operating model

The desired flow is:

```text
Discovery -> Memory Brief -> Fact Graph -> Fact Store -> Quality Gate -> Targeted Swarm -> Synthesis -> Status/Resume
```

This keeps `project-brain` powerful because it can still delegate complex analysis, but cheaper because it does not pay model tokens to rediscover stable repository facts repeatedly.
