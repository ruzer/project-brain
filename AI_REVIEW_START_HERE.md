# AI Review Start Here

This repository is `project-brain`, a repository intelligence engine. Its goal is to analyze software projects, persist useful context, coordinate bounded agents, and produce review-only recommendations.

Release context: `0.2.0` prioritizes guided `go`, progressive memory, deterministic preflight facts, bounded swarm presets, output contracts, and review-only safety for internal beta validation.

## Read Order

Start here before reading large source files:

1. `docs/architecture.md`
2. `docs/roadmap/token-aware-orchestration.md`
3. `docs/roadmap/fact-based-context-roadmap.md`
4. `docs/reference-repo-analysis/claude-mem-comparison.md`
5. `docs/reference-repo-analysis/graphify-comparison.md` if present
6. `docs/project-context/CONTEXT.md`
7. `docs/project-context/ARCHITECTURE_MAP.md`
8. `AI_CONTEXT/MEMORY_BRIEF.md` when analyzing a generated output directory
9. `AI_CONTEXT/EXECUTIVE_SUMMARY.md` when available in an output directory
10. `memory/scopes/*.json` for fresh/stale scoped memory
11. `memory/knowledge_graph/repository_fact_graph.json` when available in an output directory

## Source Entry Points

Read these source files next:

1. `cli/project-brain.ts`
2. `core/orchestrator/main.ts`
3. `core/status/index.ts`
4. `core/resume/index.ts`
5. `core/swarm_runtime/index.ts`
6. `core/ai_router/router.ts`
7. `core/token_policy/index.ts`
8. `memory/memory_brief/index.ts`
9. `memory/preflight_facts/index.ts`
10. `memory/scope_store/index.ts`
11. `memory/executive_summary/index.ts`
12. `memory/context_store/index.ts`
13. `governance/self-governance-system.ts`

## Operating Rules

- Prefer `go`, `status`, `resume`, `runbook`, and `fact-query` before broad `analyze` or model-heavy swarm work.
- Do not infer repository behavior from filenames alone.
- Use generated memory before broad source reading.
- Treat `docs/project-context/` as the curated, versioned context for this repository.
- Treat generated `AI_CONTEXT/MEMORY_BRIEF.md` as the compact handoff inside an output directory.
- Treat generated `AI_CONTEXT/EXECUTIVE_SUMMARY.md` as the human-facing release/state summary inside an output directory.
- Use `preflightFacts` before model-heavy ask or agent workflows when evidence may already exist.
- Treat `memory/knowledge_graph/repository_fact_graph.json` as structural evidence.
- Treat stale scope memory as a delta target, not truth.
- Use `UNKNOWN` when evidence is missing.
- Recommend narrow, staged changes before broad rewrites.
- Preserve review-only behavior unless the user explicitly asks for implementation.

## Token-Safe First Commands

```bash
npm run build
node dist/cli/project-brain.js start "optimize analysis and cost" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js go "understand this project" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js status . --output ./sample-output/self-optimization
node dist/cli/project-brain.js runbook "optimize analysis and cost" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js code-graph . --output ./sample-output/self-optimization
node dist/cli/project-brain.js fact-query "swarm runtime token cache" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js resume . --output ./sample-output/self-optimization
```

## Optimization Focus

The highest-value optimization work is:

1. keep `preflightFacts` and `fact-query` ahead of model-heavy work
2. keep `docs/project-context/CONTEXT.md`, `LEARNINGS.md`, `ERRORS.md`, and `DECISIONS.md` alive instead of skeletal
3. prefer factual graph, executive summary, and scope memory over long markdown reports
4. update decisions, learnings, corrections, and unknowns incrementally
5. keep swarm prompts short, scoped, and cacheable
6. preserve review-only behavior and deterministic fallbacks when Ollama/Claude are unavailable
