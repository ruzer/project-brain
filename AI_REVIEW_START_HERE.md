# AI Review Start Here

This repository is `project-brain`, a repository intelligence engine. Its goal is to analyze software projects, persist useful context, coordinate bounded agents, and produce review-only recommendations.

## Read Order

Start here before reading large source files:

1. `docs/architecture.md`
2. `docs/roadmap/token-aware-orchestration.md`
3. `docs/roadmap/fact-based-context-roadmap.md`
4. `docs/reference-repo-analysis/claude-mem-comparison.md`
5. `docs/reference-repo-analysis/graphify-comparison.md` if present
6. `AI_CONTEXT/MEMORY_BRIEF.md` when analyzing a generated output directory
7. `memory/knowledge_graph/repository_fact_graph.json` when available in an output directory

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
9. `memory/context_store/index.ts`
10. `governance/self-governance-system.ts`

## Operating Rules

- Do not infer repository behavior from filenames alone.
- Use generated memory before broad source reading.
- Treat `AI_CONTEXT/MEMORY_BRIEF.md` as the compact handoff.
- Treat `memory/knowledge_graph/repository_fact_graph.json` as structural evidence.
- Use `UNKNOWN` when evidence is missing.
- Recommend narrow, staged changes before broad rewrites.
- Preserve review-only behavior unless the user explicitly asks for implementation.

## Token-Safe First Commands

```bash
npm run build
node dist/cli/project-brain.js start "optimize analysis and cost" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js status . --output ./sample-output/self-optimization
node dist/cli/project-brain.js runbook "optimize analysis and cost" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js code-graph . --output ./sample-output/self-optimization
node dist/cli/project-brain.js fact-query "swarm runtime token cache" . --output ./sample-output/self-optimization
node dist/cli/project-brain.js resume . --output ./sample-output/self-optimization
```

## Optimization Focus

The highest-value optimization work is:

1. make all agents consume `MEMORY_BRIEF`
2. keep `AI_CONTEXT/CONTEXT.md`, `LEARNINGS.md`, `ERRORS.md`, and `DECISIONS.md` alive instead of skeletal
3. prefer factual graph and fact store context over long markdown reports
4. add a query layer over memory and graph artifacts
5. update decisions, learnings, corrections, and unknowns incrementally
6. keep swarm prompts short, scoped, and cacheable
