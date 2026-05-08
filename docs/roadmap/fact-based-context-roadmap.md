# Fact-Based Context Roadmap

## Purpose

Improve `project-brain` so repository context is built from verifiable facts instead of narrative inference.

This roadmap is intentionally general. It does not assume any specific workspace shape such as frontend/backend/mobile/panel. It focuses on product-wide improvements that apply to single-repository analysis first, with optional multi-repository support later.

## Core rule

Anything presented as a fact must be backed by one or more verifiable sources:

- source files
- configuration files
- manifests and lockfiles
- route definitions
- OpenAPI or Swagger artifacts
- SQL schema or schema dumps when explicitly provided
- generated tool outputs with stable provenance

If evidence is missing, the system should emit:

- `unknown`
- `not detected`
- `not verified`

It should not fill the gap with architectural guesses.

## Product goals

The improved context layer should answer these questions reliably:

1. What is this repository and what stack does it actually use?
2. Which modules or surfaces are visibly implemented?
3. Which integrations are confirmed by code or configuration?
4. Which gaps or drift signals are directly observable?
5. Which outputs are canonical and which are historical?

## Non-goals

- Do not make cross-repository comparison mandatory for every run.
- Do not make SQL or schema ingestion mandatory when no schema exists.
- Do not rely on LLM-only summarization for endpoints, auth, contracts, or integration compatibility.

## Design principles

### 1. Facts first

Every summary should be structured around:

- `verified_facts`
- `unknowns`
- `evidence_refs`

### 2. Extract, then summarize

For contracts, routes, auth, schema, headers, uploads, and manifests, use deterministic extractors first. Let the LLM summarize extracted data rather than inventing structure from raw code.

### 3. Unknown is better than wrong

When the system cannot confirm a relationship, it should say so explicitly instead of presenting a likely-but-unverified explanation.

### 4. Single-repo quality before workspace intelligence

The default mode should become more trustworthy for one repository before adding a broader workspace alignment mode.

## Backlog

## Phase 1

Focus: strengthen evidence discipline in current outputs.

### 1. Fact-evidence policy

Define a shared internal contract for analysis outputs:

- `verified_facts: string[]`
- `unknowns: string[]`
- `evidence_refs: string[]`

This applies to summaries, executive outputs, and synthesis artifacts.

### 2. Prompt hardening

Update swarm and summary prompts so they must:

- cite real files, routes, or config when possible
- avoid stating unverified relationships as facts
- downgrade uncertainty to `unknown` or `not verified`

### 3. Synthesis schema upgrade

Extend synthesizer outputs to carry:

- `headline`
- `summary`
- `verified_facts`
- `unknowns`
- `priorities`
- `next_steps`
- `evidence_refs`

### 4. Context quality gate

Add a new report:

- `reports/context_quality_gate.md`

The gate should verify at minimum:

- stack was identified from evidence
- outputs contain verifiable facts
- unknowns are called out explicitly
- file references are present where expected
- historical or archived outputs are not presented as active

## Phase 2

Focus: add deterministic repo-level extractor outputs.

### 5. Technical contract minimum

Add a structured contract artifact:

- `reports/technical_contract_minimum.md`

It should summarize, when visible:

- stack
- entrypoints
- API prefix or base path
- visible endpoints or route surfaces
- auth mechanism
- required headers
- file upload surfaces
- evidence references

### 6. Integration drift report

Add a repo-level drift report:

- `reports/integration_drift_report.md`

This should be based on extractor output, not LLM freeform reasoning.

Examples of drift signals:

- client-visible paths that do not match exposed paths
- auth/header mismatch across visible surfaces
- endpoints referenced but not exposed
- schema-visible entities with no visible service wiring

### 7. Maturity profile

Add:

- `analysis/maturity_profile.md`

Classify visible modules or surfaces using evidence-backed states:

- `active`
- `partial`
- `skeleton`
- `legacy`

The classification should depend on signals such as:

- executable entrypoints
- wiring and route usage
- tests
- config presence
- data flow visibility

### 8. Extractor layer

Build or formalize deterministic extractors for:

- manifests and lockfiles
- environment and config
- routes and endpoints
- auth middleware or guards
- uploads and files
- SQL schema, when explicitly provided

These extractors should emit machine-readable JSON under a dedicated output area such as:

- `AI_CONTEXT/extractors/`

## Phase 3

Focus: optional advanced capabilities.

### 9. Schema ingestion

Add optional schema-aware analysis when SQL or schema dumps are explicitly provided.

Suggested outputs:

- `reports/schema_context.md`
- `AI_CONTEXT/schema/schema_index.json`

### 10. Workspace mode

Introduce an optional workspace-level mode for analyzing multiple related repositories together.

This should not replace the existing single-repo flow.

Suggested outputs:

- `reports/workspace_alignment.md`
- `reports/domain_coverage.md`

### 11. Cross-repo drift

Inside workspace mode, compare verified integration surfaces across repositories:

- route prefixes
- visible clients vs exposed APIs
- shared auth assumptions
- schema vs service visibility

## Prioritization

### High priority

- fact-evidence policy
- prompt hardening
- synthesis schema upgrade
- context quality gate

### Medium priority

- technical contract minimum
- integration drift report
- maturity profile
- extractor layer

### Lower priority

- schema ingestion
- workspace mode
- cross-repo drift

## Acceptance criteria

A phase is only complete if:

1. the output artifact exists in a stable location
2. the artifact cites verifiable evidence
3. the system uses `unknown` or `not verified` instead of unsupported claims
4. the output works for a single repository without depending on workspace-specific assumptions

## Suggested first implementation slice

The highest-value first slice is:

1. fact-evidence policy
2. prompt hardening
3. synthesis schema upgrade
4. context quality gate

That combination improves trustworthiness immediately without forcing a deeper architectural rewrite.
