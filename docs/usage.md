# usage

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
project-brain ask "identifica este proyecto" /path/to/repo --output /path/to/output
project-brain ask "dime que le falta criticamente" /path/to/repo --output /path/to/output
project-brain ask "revisa los cambios recientes" /path/to/repo --output /path/to/output
```

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

Materialize one entry into reusable project context:

```bash
project-brain context-get node-express-api /path/to/repo --output /path/to/output
```

This writes:

- `reports/context_search.md`
- `reports/context_sources.md`
- `memory/context_registry/`
- `AI_CONTEXT/EXTERNAL_CONTEXT/<id>.md`

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
project-brain ask "identifica este proyecto" /path/to/repo
project-brain ask "ayudame a definir el stack y el alcance" /path/to/repo
project-brain swarm "ayudame a mejorar este repo" /path/to/repo
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
