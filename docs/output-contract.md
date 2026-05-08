# Output contract

This document defines the beta output contract for `project-brain` 0.2.0.

## Policy

- JSON artifacts are canonical for tools.
- Markdown artifacts are human-readable projections.
- Runtime outputs must not dirty the target repository when `--output` points outside it.
- Stale memory is evidence of work to refresh, not current truth.
- Public stable contracts cannot remove or rename required fields without a major version.
- Additive optional fields are allowed in minor releases.

## Classification

- `STABLE_PUBLIC`: safe for external tools to consume during the 0.x beta line with additive changes only.
- `STABLE_INTERNAL`: stable for project-brain commands, but not guaranteed for external consumers.
- `EXPERIMENTAL`: may change between minor releases.
- `RUNTIME_ONLY`: generated local output; do not version.
- `TEMPLATE`: source template used to generate runtime outputs.

## Artifact map

| Artifact | Path | Format | Class | Producer | Consumer |
|---|---|---|---|---|---|
| Memory brief | `AI_CONTEXT/MEMORY_BRIEF.md` | Markdown | STABLE_PUBLIC | memory brief writer | humans, agents |
| Memory brief JSON | `AI_CONTEXT/memory_brief.json` | JSON | STABLE_INTERNAL | memory brief writer | agents, preflight |
| Executive summary | `AI_CONTEXT/EXECUTIVE_SUMMARY.md` | Markdown | STABLE_PUBLIC | status/start/resume/runbook | humans, handoff |
| Executive summary JSON | `AI_CONTEXT/executive_summary.json` | JSON | STABLE_INTERNAL | executive summary writer | resume/runbook/preflight |
| Scope memory | `memory/scopes/*.json` | JSON | STABLE_INTERNAL | scope store/swarm | preflight, fact-query |
| Repository fact graph | `memory/knowledge_graph/repository_fact_graph.json` | JSON | STABLE_PUBLIC | code graph/fact graph | fact-query, preflight |
| Repository fact graph report | `reports/repository_fact_graph.md` | Markdown | STABLE_INTERNAL | fact graph | humans |
| Fact query report | `reports/fact_query.md` | Markdown | STABLE_PUBLIC | fact-query | humans, agents |
| Fact query JSON | `AI_CONTEXT/fact_query/fact_query.json` | JSON | STABLE_INTERNAL | fact-query | agents |
| Runbook report | `reports/runbook.md` | Markdown | STABLE_PUBLIC | runbook | humans |
| Runbook JSON | `AI_CONTEXT/runbook/runbook.json` | JSON | STABLE_INTERNAL | runbook | resume, agents |
| Doctor report | `reports/doctor.md` | Markdown | RUNTIME_ONLY | doctor | humans |
| Doctor template | `reports/templates/doctor.md` | Markdown | TEMPLATE | source | doctor docs |
| Runtime directory | `.project-brain/runtime/` | mixed | RUNTIME_ONLY | local runs | local diagnostics |
| Validation matrix | `reports/validation-matrix.md` | Markdown | STABLE_INTERNAL | release QA | maintainers |
| Validation results | `reports/validation-results.json` | JSON | STABLE_INTERNAL | release QA | maintainers |
| Beta readiness | `reports/beta-readiness.md` | Markdown | STABLE_INTERNAL | release QA | maintainers |
| Release candidate report | `reports/release-candidate-*.md` | Markdown | STABLE_INTERNAL | release QA | maintainers |

## Minimal examples

### Repository fact graph

Schema: `schemas/repository_fact_graph.schema.json`

```json
{
  "version": 1,
  "generatedAt": "2026-05-08T00:00:00.000Z",
  "targetPath": "/repo",
  "repoName": "repo",
  "nodes": [{ "id": "repo:repo", "kind": "repository", "label": "repo" }],
  "edges": [],
  "stats": { "nodes": 1, "edges": 0, "codeGraphFiles": 0, "codeGraphSymbols": 0, "nodeKinds": { "repository": 1 }, "edgeKinds": {} }
}
```

### Preflight facts

Schema: `schemas/preflight_facts.schema.json`

`preflightFacts` is currently embedded in workflow results such as `AskResult`. It is the first deterministic gate before model-heavy work.

### Validation results

Schema: `schemas/validation_results.schema.json`

`reports/validation-results.json` records beta validation command outcomes and quality notes.
