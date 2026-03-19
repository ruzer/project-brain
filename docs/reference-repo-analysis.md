# Reference Repo Analysis

This document compares `project-brain` against the external reference repositories that were cloned for code-level inspection.

## Scope

Cloned references used in this review:

- `gsd-build/get-shit-done`
- `andrewyng/context-hub`
- `tirth8205/code-review-graph`
- `nyldn/claude-octopus`
- `opendataloader-project/opendataloader-pdf`
- `LucidAkshay/kavach`

`zai-org/GLM-OCR` was assessed as a lower-priority complement rather than a core reference. Its local clone did not complete cleanly during this pass, so it is not part of the deep code comparison below.

## Executive summary

What `project-brain` should adopt next:

1. A control-tower UX: simple intent in, routed workflow out.
2. Task packets and explicit project state inspired by `get-shit-done` and `claude-octopus`.
3. A policy and approval layer for agent execution inspired by `kavach`.
4. A registry-backed `context search/get` layer inspired by `context-hub`.
5. A document ingestion boundary inspired by `opendataloader-pdf`.

What `project-brain` should not copy directly:

- automatic execution and commit-heavy workflows from `get-shit-done`
- multi-provider orchestration complexity from `claude-octopus`
- plugin and hook ecosystems tied to a specific host agent
- GPLv3 implementation code from `kavach`

## Current position of project-brain

`project-brain` already has strengths that the reference projects do not combine in one place:

- repository discovery and workspace analysis
- durable `AI_CONTEXT` generation
- specialist analysis agents
- governance and proposal reporting
- non-destructive defaults
- local annotations
- `code-graph-v2` for TS/JS with incremental hashes, symbols, and typed edges
- impact-radius and review-delta support

Main remaining gaps:

- context retrieval is still local-only, not registry backed
- CLI still expects the user to know the right command
- project state and task packets are not yet first-class workflow artifacts
- there is no agent firewall or policy engine for approval, tool access, and destructive-action controls
- document ingestion is still out of band

## 1. get-shit-done

### What it is

`get-shit-done` is a workflow system more than a repository intelligence engine. Its core is a file-based planning runtime with commands, templates, state transitions, and agent markdown definitions.

### Code surfaces inspected

- `get-shit-done/bin/lib/init.cjs`
- `get-shit-done/bin/lib/state.cjs`
- `docs/ARCHITECTURE.md`

### What is strong

- Compound `init` commands return structured workflow context.
- State is explicit, readable, and file-backed.
- Templates and workflow assets are productized and easy to extend.
- Brownfield onboarding is treated as a first-class path.

### What maps well to project-brain

- A guided planning layer after analysis.
- Explicit state artifacts for improvement execution.
- Templates for common repo outcomes such as roadmap, concerns, decisions, and implementation tracks.

### What does not map well

- Automatic execution assumptions.
- Commit-centric workflow progression.
- Large markdown-command/plugin surface that is tied to host agents.

### Decision

Adopt the planning and state ideas, not the execution model.

### Recommended follow-up

Build a `plan-improvements` command that turns findings, annotations, impact data, and governance output into:

- `docs/improvement_plan/ROADMAP.md`
- `docs/improvement_plan/STATE.md`
- `docs/improvement_plan/TRACKS.md`

## 2. context-hub

### What it is

`context-hub` is a registry and retrieval CLI for curated docs and skills. It has a clean split between discovery, cache, annotations, source trust, and content fetch.

### Code surfaces inspected

- `cli/src/commands/search.js`
- `cli/src/commands/get.js`
- `cli/src/lib/registry.js`
- `cli/src/lib/annotations.js`
- `docs/design.md`

### What is strong

- Registry-backed retrieval instead of hardcoded context.
- Multiple sources merged into one search surface.
- Trust filtering via `official | maintainer | community`.
- BM25 search index for low-cost retrieval.
- Clear `search` and `get` separation.

### What maps well to project-brain

- A `context search` command for frameworks, providers, and stack patterns.
- A `context get` command for selective retrieval.
- Source metadata and trust policy.
- Cached registries and lightweight local index.

### What project-brain already took

- Persistent annotations.

### What project-brain is still missing

- search
- get
- source registry
- trust policy
- cached retrieval for external context

### Decision

High-value adaptation target.

### Recommended follow-up

Add:

- `project-brain context-search <query>`
- `project-brain context-get <id>`
- `project-brain context-sources`

With a local registry under `memory/context_registry/` and trust-aware metadata.

## 3. code-review-graph

### What it is

`code-review-graph` is the strongest reference for the missing analytical core in `project-brain`: a persistent, incremental, symbol-aware code graph.

### Code surfaces inspected

- `code_review_graph/graph.py`
- `code_review_graph/incremental.py`
- `code_review_graph/parser.py`
- `code_review_graph/tools.py`

### What is strong

- Tree-sitter parsing across multiple languages.
- SQLite-backed graph store with nodes and typed edges.
- File hashes and incremental re-parse.
- Blast-radius and review-context queries over graph data.
- MCP tool layer that exposes graph operations cleanly.

### Where project-brain is currently behind

`project-brain` already closed part of this gap with `code-graph-v2` for TS/JS:

- symbol-aware graph extraction via the TypeScript compiler
- incremental refresh keyed by file hash
- typed edges such as `imports`, `contains`, and `calls`

Remaining gaps versus this reference:

- JSON artifact instead of a richer queryable store
- TS/JS-first scope instead of multi-language support
- no first-class test coverage edges yet
- no graph query surface such as callers/callees/tests-for commands yet

### What maps well to project-brain

- Persistent graph store in `memory/code_graph/`
- Symbol-aware parsing for TypeScript/JavaScript first
- Incremental updates keyed by file hash
- Queries such as:
  - callers of symbol
  - files importing module
  - tests covering symbol
  - review context for changed file set

### Decision

Highest-priority technical reference.

### Recommended follow-up

Evolve `code-graph-v2` with a staged v3:

1. SQLite store
2. symbol table
3. typed edges
4. incremental updater
5. graph queries for callers/callees/tests
6. richer `review-delta` context builder

## 4. claude-octopus

### What it is

`claude-octopus` is a workflow and orchestration product. Its strength is not repository analysis depth but multi-agent coordination, provider routing, and quality gates.

### Code surfaces inspected

- `scripts/orchestrate.sh`
- `hooks/quality-gate.sh`
- `agents/config.yaml`
- `docs/ARCHITECTURE.md`

### What is strong

- Phase model with explicit defaults.
- Agent registry defined in config instead of hardcoded logic only.
- Provider routing by phase.
- Quality gate hooks.
- Worktree isolation for concurrent writers.
- Strong operational hardening around shell execution.

### What maps well to project-brain

- intent router
- explicit workflow phases
- configurable agent registry and role metadata
- stronger quality gate model for proposal promotion

### What project-brain already took

- a consensus gate for proposals

### What does not map well

- provider sprawl and plugin-heavy architecture
- shell-first orchestration
- worktree execution before `project-brain` even needs write-mode execution

### Decision

Useful product/UX reference, but not the next core engine dependency.

### Recommended follow-up

Add a high-level command such as:

`project-brain ask "review the latest backend changes"`

That routes to:

- `map-codebase`
- `review-delta`
- `impact-radius`
- `analyze`

Depending on intent.

## 5. GLM-OCR

### Position

Useful as a future ingestion extension, not as a core reference for the current engine.

### Why it is lower priority

It helps with:

- PDFs
- screenshots
- architecture documents
- scanned artifacts

It does not materially improve:

- code graph depth
- impact analysis
- governance quality
- review-delta context

### Decision

Do not prioritize now. Treat it as a future `ingest-doc` module.

## 6. opendataloader-pdf

### What it is

`opendataloader-pdf` is a document ingestion engine for turning PDFs into structured Markdown, JSON, HTML, and image-aware artifacts with optional OCR and hybrid AI enrichment.

### Code surfaces inspected

- `opendataloader-pdf/README.md`
- `opendataloader-pdf/options.json`
- `opendataloader-pdf/schema.json`
- `opendataloader-pdf/package.json`

### What is strong

- Clean output contract via a published JSON schema.
- Deterministic local mode plus optional hybrid mode for harder pages.
- Multiple output formats that map well to LLM context pipelines.
- Explicit safety and sanitization options such as `content-safety-off` and `sanitize`.
- Multi-language packaging that makes embedding easier later.

### What maps well to project-brain

- A future `ingest-doc` command for PDFs, ADRs, audits, diagrams, and scanned runbooks.
- Normalized artifacts under `AI_CONTEXT` or `docs/ingested/`.
- A structured JSON contract that can be indexed and summarized.
- Sanitization before document artifacts enter prompt context.

### What does not map well

- It does not improve repository graph depth, review-delta quality, or proposal governance directly.
- Java and hybrid backend requirements would add operational overhead if pulled into the core engine too early.

### Decision

Useful future ingestion boundary. Keep it out of the core orchestrator for now.

### Recommended follow-up

Add a separate module later:

- `project-brain ingest-doc <path>`
- `project-brain ingest-doc --format markdown,json`

That stores normalized output in `docs/ingested/` and registers it as optional context.

## 7. kavach

### What it is

`kavach` is a local AI workspace monitor and defensive control layer. It watches file operations, classifies risk, quarantines changes, tracks rollback material, and exposes kill-switch style controls.

### Code surfaces inspected

- `kavach/README.md`
- `kavach/src-tauri/src/lib.rs`
- `kavach/src-tauri/src/clipboard.rs`
- `kavach/src-tauri/src/honeypot.rs`

### What is strong

- Risk classification is explicit and tied to actual file-system events.
- Quarantine and temporal rollback give a practical recovery path.
- Honeypots and clipboard monitoring extend beyond simple file watching.
- PID chokehold and timeout termination show how approvals can be enforced, not just suggested.
- The product is local-first and designed around hostile or unstable agent behavior.

### What maps well to project-brain

- An `Agent Firewall` layer for task risk scoring, tool permissions, and destructive-action approvals.
- Approval gates before write, delete, shell, network, or deploy operations.
- Recovery artifacts such as snapshots, rollback bundles, and audit logs.
- Policy packs such as `safe-readonly`, `review`, `edit-limited`, and `deploy`.

### What does not map well

- `kavach` is GPLv3, so `project-brain` should not copy code from it unless you are willing to accept GPL obligations.
- It is an EDR/workspace monitor, not a repository intelligence engine.
- Its Tauri desktop app and OS-specific controls are heavier than what `project-brain` needs in the first pass.

### Decision

High-value architectural reference. Adapt the control model, not the code.

### Recommended follow-up

Build an internal policy layer with:

- task risk classifier
- tool access matrix
- approval gates
- audit trail
- rollback hooks for controlled write mode

## Prioritized roadmap from this comparison

### Priority 1

Intent router and task packets so the user can give simple instructions.

### Priority 2

Agent firewall and approval model inspired by `kavach`.

### Priority 3

Registry-backed context retrieval inspired by `context-hub`.

### Priority 4

Planning and roadmap artifacts inspired by `get-shit-done`.

### Priority 5

Optional OCR/document ingestion inspired by `opendataloader-pdf` and `GLM-OCR`.

## Copy / adapt / ignore matrix

| Reference | Copy directly | Adapt carefully | Ignore for now |
| --- | --- | --- | --- |
| get-shit-done | almost nothing | file-based planning state, templates, guided workflow | auto-commits, plugin command sprawl |
| context-hub | annotation simplicity | registry, BM25 search, trust policy, fetch model | broad content universe before curated scope exists |
| code-review-graph | almost nothing line-for-line | graph store model, incremental updates, graph queries | embeddings first, visualization-first workflow |
| claude-octopus | almost nothing line-for-line | intent router, phases, config-driven roles, quality gates | multi-provider complexity, shell-heavy plugin layer |
| opendataloader-pdf | almost nothing line-for-line | document ingestion boundary, schema-backed artifacts, sanitization before context load | pulling OCR/hybrid runtime into the core engine too early |
| kavach | nothing line-for-line | policy engine, approvals, rollback model, audit trail, task risk levels | GPL code reuse, full desktop EDR scope in the first pass |
| GLM-OCR | nothing right now | document ingestion boundary later | OCR in the core engine |

## Concrete next implementation order

1. `ask`
2. `task-packet-builder`
3. `agent-firewall`
4. `context-search`
5. `context-get`
6. `plan-improvements`
7. `ingest-doc`
