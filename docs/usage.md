# usage

## Recommended beta path

Start here for normal use:

```bash
project-brain go "understand this project and suggest the next safe step" /path/to/repo --output /path/to/output
```

Use the guided console when the user should not remember command names:

```bash
project-brain console --target /path/to/repo --output /path/to/output
```

Read these docs for release-candidate operation:

- `docs/installation.md`
- `docs/first-analysis-5-min.md`
- `docs/output-contract.md`
- `docs/release-checklist.md`
- `docs/user-test-script.md`

## Build

```bash
npm install
npm run build
```

## Validate locally

```bash
npm run hooks:install
npm run lint
npm run typecheck
npm run verify
```

## Repository hardening

Before opening the repo to public contributions, install the local gates:

```bash
npm run hooks:install
```

The repository now provides:

- `pre-commit`: blocks staged secrets, weak local-only paths, and runs `npm run lint`
- `commit-msg`: blocks placeholder commit messages like `wip`
- `pre-push`: runs `npm run verify:quick`
- GitHub CI: runs lint, typecheck, build, tests, smoke tests, and repository safety scan
- GitHub dependency review and security baseline workflows

For GitHub-side settings such as branch protection and secret scanning, follow `docs/github-hardening.md`.

## Analyze a repository

Map an existing repository into structured onboarding docs:

```bash
project-brain map-codebase /path/to/repo --output /path/to/output
```

Start with plain language instead of choosing a command manually:

```bash
project-brain start "quiero analizar y mejorar este proyecto" /path/to/repo --output /path/to/output
project-brain ask "identifica este proyecto" /path/to/repo --output /path/to/output
project-brain ask "dime que le falta criticamente" /path/to/repo --output /path/to/output
project-brain ask "revisa los cambios recientes" /path/to/repo --output /path/to/output
```

`start` is the simple path for non-technical users. It runs cheap deterministic preflight first: doctor, codebase map, code graph, fact query, runbook, harness audit, and firewall. It does not run the model-heavy swarm unless you pass `--with-swarm`.

`go` is the preferred alias for beta users. Use `status`, `resume`, `runbook`, and `fact-query` before broad swarm analysis.

`ask` routes the request into the current best workflow and writes `reports/ask_brief.md` with artifacts and suggested next prompts.

Persist a stateful improvement plan:

```bash
project-brain plan-improvements /path/to/repo --trigger repository-change --output /path/to/output
```

This writes:

- `docs/improvement_plan/SUMMARY.md`
- `docs/improvement_plan/STATE.md`
- `docs/improvement_plan/KNOWN_RISKS.md`
- `docs/improvement_plan/ROADMAP.md`
- `docs/improvement_plan/TRACKS.md`

Search the curated local context registry:

```bash
project-brain context-search "express observability" /path/to/repo --output /path/to/output
project-brain context-search "vitest testing" /path/to/repo --trust official --output /path/to/output
project-brain context-sources /path/to/repo --output /path/to/output
```

Discover ecosystem repos from GitHub and feed them into the same local context registry:

```bash
project-brain ecosystem-radar /path/to/repo --output /path/to/output
project-brain ecosystem-radar /path/to/repo --bucket memory --limit 4 --output /path/to/output
project-brain ecosystem-radar /path/to/repo --seed-only --output /path/to/output
```

Materialize one entry into reusable project context:

```bash
project-brain context-get node-express-api /path/to/repo --output /path/to/output
```

This writes:

- `reports/context_search.md`
- `reports/context_sources.md`
- `reports/ecosystem_radar.md`
- `memory/context_registry/`
- `AI_CONTEXT/EXTERNAL_CONTEXT/<id>.md`

If `GITHUB_TOKEN` is set, `ecosystem-radar` uses authenticated GitHub API requests. Without it, the command still works against public repositories but hits tighter rate limits.

This produces `docs/codebase_map/` with:

- `SUMMARY.md`
- `STACK.md`
- `INTEGRATIONS.md`
- `ARCHITECTURE.md`
- `STRUCTURE.md`
- `CONVENTIONS.md`
- `TESTING.md`
- `CONCERNS.md`

Persist local repo notes so future runs do not forget them:

```bash
project-brain annotate /path/to/repo "The payments area has risky legacy behavior" --output /path/to/output
project-brain annotate /path/to/repo --list --output /path/to/output
```

Annotations are written to `AI_CONTEXT/ANNOTATIONS.md` and also appear in the generated codebase map summary.

Compute impact radius for a targeted set of files:

```bash
project-brain impact-radius /path/to/repo --files src/core/service.ts,src/api/router.ts --output /path/to/output
```

This writes a persistent symbol-aware graph to `memory/code_graph/code_graph_v2.json` and an actionable review set to `reports/impact_radius.md`.

Build or refresh the code graph without running impact analysis:

```bash
project-brain code-graph /path/to/repo --output /path/to/output
```

This now writes:

- `memory/code_graph/code_graph_v2.json`
- `memory/knowledge_graph/repository_fact_graph.json`
- `reports/repository_fact_graph.md`

The repository fact graph is intentionally factual only. It reuses verified discovery and code-graph relations, and does not add inferred or ambiguous edges.

Query compact factual memory without calling an AI model:

```bash
project-brain fact-query "swarm runtime token cache" /path/to/repo --output /path/to/output
```

This writes:

- `reports/fact_query.md`
- `AI_CONTEXT/fact_query/fact_query.json`

Use this before giving another AI a broad task. It returns a short deterministic answer plus matching memory lines, graph nodes, graph edges, evidence refs, and unknowns.

Create a token-aware runbook before expensive analysis:

```bash
project-brain runbook "optimize analysis and cost" /path/to/repo --output /path/to/output
```

This writes:

- `reports/runbook.md`
- `AI_CONTEXT/runbook/runbook.json`

The runbook orders cheap deterministic steps before model-heavy work: doctor, map, code graph, fact query, harness audit, firewall, bounded swarm, planning, resume.

Audit the agent harness before model-heavy analysis:

```bash
project-brain harness-audit /path/to/repo --output /path/to/output
```

This writes:

- `reports/harness_audit.md`
- `AI_CONTEXT/harness_audit/harness_audit.json`

The harness audit is deterministic and model-free. It checks whether progressive memory exists before broad analysis: compact memory index, factual graph, filtered context query, execution controls, and deep analysis memory. This adapts the useful parts of memory-first and harness-optimization systems without making project-brain Claude-specific.

Review the latest git delta instead of naming files manually:

```bash
project-brain review-delta /path/to/repo --base HEAD~1 --head HEAD --output /path/to/output
```

`review-delta` computes:

- changed files from git
- direct and transitive dependents
- related tests
- a minimal review set

Inspect the agent firewall before running a full cycle:

```bash
project-brain firewall /path/to/repo --trigger repository-change --output /path/to/output
```

This writes:

- `reports/agent_firewall.md`
- `memory/firewall/agent_firewall.json`
- `tasks/packets/*.md`

```bash
project-brain analyze /path/to/repo
```

Write generated output outside the target repository:

```bash
project-brain analyze /path/to/repo --output /path/to/output
```

Use a longer Ollama timeout for local AI analysis:

```bash
project-brain analyze /path/to/repo --ollama-timeout 240000
```

## Model roles

`project-brain models` now shows both Ollama residency and task profiles.

Default runtime split:

- `worker`: `qwen2.5-coder:7b`
- `reviewer`: `deepseek-coder:6.7b`
- `reasoning`: `llama3.1:8b`
- `planner`: `kimi-k2.5:cloud`
- `synthesizer`: `llama3.1:8b`

Use that split to keep discovery, review, and day-to-day analysis cheap and local while reserving the planner for strategic or ambiguous asks.

## Swarm presets

Use bounded swarm only after deterministic memory and facts have been checked.

```bash
project-brain swarm "review risky areas without modifying files" /path/to/repo --output /path/to/output --preset cheap
project-brain swarm "review architecture risks" /path/to/repo --output /path/to/output --preset balanced
project-brain swarm "deep review of critical modules" /path/to/repo --output /path/to/output --preset thorough
```

- `cheap`: fastest and most economical, smaller queue and lower timeout budget.
- `balanced`: recommended default for meaningful coverage.
- `thorough`: slower and more expensive, use only when cost/time is justified.

## Runtime artifact policy

Version source docs, templates, contracts, and schemas.

Release and validation reports under `reports/validation-*.md`, `reports/validation-results.json`, `reports/beta-readiness.md`, and `reports/release-candidate-*.md` are deliberate versioned evidence. Ad hoc runtime reports such as `reports/doctor.md` remain ignored.

Do not version generated local runtime outputs:

- `.claude/`
- `.project-brain/runtime/`
- `AI_CONTEXT/doctor/`
- `reports/doctor.md`

Use `--output` outside the target repository when validating real projects.

## Typical repository workflow

Frontend usability cycle:

```bash
project-brain analyze \
  /path/to/frontend-repo \
  --output /path/to/output \
  --trigger repository-change \
  --ollama-timeout 240000 \
  --verbose
```

Workspace-wide analysis:

```bash
project-brain analyze \
  /path/to/workspace \
  --output /path/to/output \
  --trigger repository-change
```

## Prompt template usage

The templates in `prompts/context_templates/` are intended for external repositories. Use them when a coding agent needs high-quality context before proposing frontend, UX, architecture, or performance changes.

Recommended templates:

- `context_bootstrap_master.md`: create or refresh `AI_CONTEXT/` from the real repository state
- `frontend_analysis.md`: analyze operational frontend surfaces
- `ux_improvement.md`: produce UX-focused improvement tasks
- `architecture_review.md`: review module boundaries and structural risk
- `performance_review.md`: find low-risk performance wins

Recommended process:

1. Run `project-brain map-codebase` against the target repository.
2. Run `project-brain analyze` for specialist-agent reports and proposals.
3. Run `project-brain review-delta` when you need a bounded review surface for a recent change.
4. Collect the generated `AI_CONTEXT`, codebase map, reports, and task artifacts.
5. Combine those artifacts with one of the prompt templates.
6. Use the resulting context in the downstream coding agent.

## Common commands

```bash
project-brain init /path/to/repo
project-brain map-codebase /path/to/repo
project-brain annotate /path/to/repo "Known legacy hotspot" --output /path/to/output
project-brain code-graph /path/to/repo
project-brain impact-radius /path/to/repo --files src/core/service.ts
project-brain review-delta /path/to/repo
project-brain start "quiero analizar y mejorar este proyecto" /path/to/repo
project-brain ask "identifica este proyecto" /path/to/repo
project-brain ask "ayudame a definir el stack y el alcance" /path/to/repo
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --preset cheap
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --preset balanced
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --preset thorough
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 3
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 3 --chunk-size 1
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 3 --chunk-size 1 --task-timeout-ms 12000 --max-retries 1
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 2 --chunk-size 1 --planner-timeout-ms 8000 --synthesis-timeout-ms 8000 --run-timeout-ms 30000 --max-queued-tasks 8
project-brain self-improve /path/to/repo
project-brain plan-improvements /path/to/repo --trigger repository-change
project-brain context-search "express observability" /path/to/repo
project-brain context-get node-express-api /path/to/repo
project-brain context-sources /path/to/repo
project-brain firewall /path/to/repo --trigger repository-change
project-brain doctor /path/to/repo
project-brain status /path/to/repo --output /path/to/output
project-brain agents /path/to/repo
project-brain weekly /path/to/repo
project-brain report /path/to/output
project-brain models
```

## Safety

`project-brain` analyzes and proposes. It does not modify target code automatically. Generated patch proposals remain review-only, weakly corroborated proposals are downgraded to human review by the consensus gate, and the agent firewall classifies each task before execution into a bounded policy pack.

## Doctor

`project-brain doctor` is the environment and runtime health check inspired by orchestration-first tools like Agent Orchestrator.

It validates:

- Node runtime compatibility
- `git` availability and target repo status
- `ollama` availability
- model inventory and configured profiles
- local swarm readiness
- `config/models.json`
- built CLI artifact presence
- output-path writability

Artifacts land in `reports/doctor.md` and `AI_CONTEXT/doctor/doctor.json`.

Doctor reports now include suggested follow-up commands, prioritized from high to low.

## Status

`project-brain status` is the operational snapshot view inspired by the “single command status” idea from Agent Orchestrator, but adapted to artifact-based analysis instead of live agent sessions.

It summarizes:

- git repo and branch
- latest doctor state
- presence of swarm/improvement-plan/codebase-map/firewall/impact/ask artifacts
- artifact timestamps in the current output path

Artifacts land in `reports/status.md` and `AI_CONTEXT/status/status.json`.

Status reports also include suggested follow-up commands derived from the current artifact state.

## Resume

`project-brain resume` is the state-recovery view for the control tower.

It reads the current output path, finds the latest useful artifact, identifies the stage where the project last stopped, and suggests the next command to continue from there.

Typical resume stages:

- `doctor`
- `map-codebase`
- `ask`
- `swarm`
- `plan-improvements`
- `review-delta`
- `firewall`

Artifacts land in `reports/resume.md` and `AI_CONTEXT/resume/resume.json`.

`project-brain ask` now routes continuation prompts like `continua con el proyecto` or `retoma donde nos quedamos` into this recovery flow automatically.
If the next move is clear and bounded, `ask` will also execute one guided continuation step automatically instead of only suggesting it.

## Swarm mode

`project-brain swarm` is the first bounded delegation layer:

- `planner`: splits the user intent into small tasks
- `worker`: scans scope and implementation details
- `reviewer`: stresses risks and weak spots
- `reasoning`: turns findings into decisions and next steps
- `synthesizer`: merges the delegated outputs into one report

Artifacts land in `reports/swarm_run.md` and `AI_CONTEXT/swarm/swarm_run.json`.
Use `--preset cheap`, `--preset balanced`, or `--preset thorough` before tuning low-level runtime flags manually.
If you do not pass `--parallel`, `project-brain` picks a bounded worker count from local CPU, load average, and free memory.
If you do not pass `--chunk-size`, `project-brain` picks a repo-slice size from repository size and then enqueues smaller scope chunks so local workers inspect only a few top-level areas at a time.
The worker queue is round-robin, so a short queue budget samples multiple parent tasks before going deeper into any single one.
If a worker exceeds `--task-timeout-ms`, the swarm retries or splits the scope chunk into smaller ones before giving up, capped by `--max-retries`.
Use `--planner-timeout-ms`, `--synthesis-timeout-ms`, and `--run-timeout-ms` to keep the whole run bounded, and `--max-queued-tasks` to stop the queue from growing beyond a fixed budget. When you do not pass `--max-queued-tasks`, `project-brain` derives queue pressure from CPU load and free memory. When those budgets are short enough, `project-brain` will also keep planner and synthesis on local Ollama models instead of reaching for a remote planner, and it will clamp auto-selected concurrency so the local run stays bounded.
If a single large scope like `agents/` or `core/` times out, the swarm now splits it into immediate child scopes such as `agents/security_agent` or `core/orchestrator` before retrying.
If the user intent names a path like `core/swarm_runtime`, the swarm now treats that as a scope hint and pulls the matching project area to the front of the queue.
If a local model returns labeled Markdown or plain text instead of strict JSON, the swarm now recovers `summary`, `findings`, `recommendations`, `priorities`, and `next_steps` before degrading to an empty result.

## Self-improve

`project-brain self-improve` is a thin wrapper around the swarm with defaults tuned for local repo self-analysis:

- `chunk-size=1`
- `task-timeout-ms=12000`
- `planner-timeout-ms=8000`
- `synthesis-timeout-ms=8000`
- `run-timeout-ms=45000`
- `max-retries=1`

`parallelism` and queue budget are left adaptive on purpose, so `self-improve` can shrink itself automatically when the machine is already under pressure. It also uses a `source-first` scope bias so the first queued chunks prefer product code areas over `tests/` and top-level config files.
Use it when you want `project-brain` to inspect a repository, including itself, without hand-tuning the swarm flags first.

## Recommended release workflows

Use `go` as the main entry point when you do not want to remember individual
commands:

```bash
project-brain go "understand this project and recommend the next step" /path/to/repo --output /path/to/output
```

Use these deterministic commands before model-heavy work:

```bash
project-brain status /path/to/repo --output /path/to/output
project-brain runbook "what should I do next?" /path/to/repo --output /path/to/output
project-brain fact-query "known fact or module name" /path/to/repo --output /path/to/output
```

Use swarm presets only when memory/fact checks are insufficient:

```bash
project-brain swarm --preset cheap "inspect this module" /path/to/repo --output /path/to/output
project-brain swarm --preset balanced "review critical risks" /path/to/repo --output /path/to/output
project-brain swarm --preset thorough "deep review" /path/to/repo --output /path/to/output
```

Preset meanings:

- `cheap`: fast/economic, fewer tasks.
- `balanced`: recommended default for better coverage.
- `thorough`: slower/costlier, maximum coverage.

## Progressive memory

The current memory stack is:

- `AI_CONTEXT/MEMORY_BRIEF.md`: compact agent/human handoff.
- `AI_CONTEXT/EXECUTIVE_SUMMARY.md`: project status, risks, scopes, and next actions.
- `memory/scopes/*.json`: per-scope facts, coverage, freshness, and evidence.
- `memory/knowledge_graph/repository_fact_graph.json`: structural repository facts.
- `preflightFacts`: read-only factual preflight before ask/model flows.

Fresh and complete scope memory may reduce queued swarm work. Stale scope memory
is reported as stale and is not used as current factual evidence.

## Runtime artifact policy

Project Brain versions source documentation, templates, contracts, and curated
`AI_CONTEXT/*.md` memory files. Runtime diagnostics and local agent state are
generated per machine/session and are ignored by git.

Versioned examples:

- `AI_CONTEXT/*.md` curated project memory
- `reports/templates/*.md` report templates
- `docs/**` source documentation

Ignored runtime examples:

- `.claude/`
- `AI_CONTEXT/doctor/`
- `reports/doctor.md`
- `.project-brain/runtime/`

Generated doctor output can include absolute local paths, local model inventory,
runtime versions, and branch-specific diagnostics. Use
`reports/templates/doctor.md` as the stable source contract instead of tracking
the generated report.
