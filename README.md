# project-brain

`project-brain` is a non-destructive repository analysis engine for software systems and AI-assisted engineering workflows. It analyzes target repositories, builds durable context, runs specialist agents, generates reports, and produces review-only patch proposals.

Typical use cases include:

- frontend usability analysis
- architecture review
- backlog generation
- context prompt generation for downstream coding agents

`project-brain` never applies code changes automatically to the target repository.

## What it does

- scans repositories and workspaces
- builds `AI_CONTEXT` memory artifacts
- maps repositories into structured onboarding docs
- preserves local repository annotations across runs
- computes blast radius and minimal review sets from file changes
- classifies agent tasks into firewall policy packs and persists task packets
- runs specialist agents for QA, UX, architecture, optimization, documentation, and development review
- generates backlog-style implementation tasks
- applies a proposal consensus gate before elevating recommendations
- produces review-only patch proposals for human approval
- exports reusable prompt templates for external repositories and downstream coding agents

## Architecture

Current runtime flow:

```text
CLI -> Orchestrator -> Discovery -> Context Builder -> Agent Firewall -> Code Graph / Agents -> Consensus Gate -> Reports -> Patch Proposals
```

Key modules:

- `agents/`: specialist analysis agents
- `analysis/`: repository scanners and deterministic analyzers
- `core/`: orchestration, routing, and runtime coordination
- `memory/`: context, learnings, and persistent analysis state
- `tools/`: patch proposal and repo inspection utilities
- `cli/`: command entrypoints
- `prompts/context_templates/`: reusable prompt templates for external projects

The codebase intentionally keeps the existing top-level runtime layout for compatibility. A physical move into `src/` was not performed because that would require import-path and build refactors.

## Repository layout

```text
project-brain/
  agents/
  analysis/
  cli/
  config/
  core/
  docs/
  governance/
  integrations/
  memory/
  orchestrator/
  prompts/
    agent_prompts/
    context_templates/
  scripts/
  shared/
  tools/
```

## Installation

```bash
npm install
npm run build
```

## Validation

```bash
npm run hooks:install
npm run lint
npm run typecheck
npm run verify
```

## Typical usage

Map an existing repository before deeper analysis:

```bash
project-brain map-codebase /path/to/repo --output /path/to/output
```

Use plain language and let `project-brain` route the workflow:

```bash
project-brain ask "identifica este proyecto" /path/to/repo --output /path/to/output
```

Persist a project-level improvement roadmap from the current analysis state:

```bash
project-brain plan-improvements /path/to/repo --trigger repository-change --output /path/to/output
```

Search curated stack guidance and materialize it into project context:

```bash
project-brain context-search "express observability" /path/to/repo --output /path/to/output
project-brain context-get node-express-api /path/to/repo --output /path/to/output
```

Attach persistent local context for future runs:

```bash
project-brain annotate /path/to/repo "This repo has a fragile legacy auth boundary" --output /path/to/output
```

Compute blast radius for a file or a set of files:

```bash
project-brain impact-radius /path/to/repo --files src/core/service.ts,src/api/router.ts --output /path/to/output
```

Build or refresh the persistent code graph directly:

```bash
project-brain code-graph /path/to/repo --output /path/to/output
```

Review the latest git delta with an import graph-backed review set:

```bash
project-brain review-delta /path/to/repo --base HEAD~1 --head HEAD --output /path/to/output
```

Inspect the current agent policy, approvals, and task packets before deeper analysis:

```bash
project-brain firewall /path/to/repo --trigger repository-change --output /path/to/output
```

Analyze a repository in place:

```bash
project-brain analyze /path/to/repo
```

Keep generated artifacts outside the target repository:

```bash
project-brain analyze /path/to/repo --output /path/to/output
```

Analyze a frontend repository with local AI routing:

```bash
project-brain analyze \
  /path/to/frontend-repo \
  --output /path/to/output \
  --trigger repository-change \
  --ollama-timeout 240000 \
  --verbose
```

## Local AI runtime

`project-brain` supports local inference through Ollama and can operate offline when local models are available.

Current default model roles:

- `worker`: `qwen2.5-coder:7b`
- `reviewer`: `deepseek-coder:6.7b`
- `reasoning`: `llama3.1:8b`
- `planner`: `kimi-k2.5:cloud`
- `synthesizer`: `llama3.1:8b`

That means routine repo work stays on local models, while strategic intent routing and architecture-heavy asks can use `kimi-k2.5:cloud` through Ollama when allowed.

Timeout precedence:

1. `project-brain analyze --ollama-timeout <ms>`
2. `OLLAMA_TIMEOUT_MS`
3. `config/models.json -> ollama_timeout_ms`
4. built-in default: `180000`

Inspect configured models:

```bash
project-brain models
```

Run a health check for the local environment, model config, git, and swarm readiness:

```bash
project-brain doctor /path/to/repo --output /path/to/output
```

`doctor` now emits prioritized suggested next actions after the checks, so the output can move straight into the next control-tower step.

Show the current operational snapshot for an output folder, including doctor/swarm/plan artifacts:

```bash
project-brain status /path/to/repo --output /path/to/output
```

`status` also emits suggested follow-up commands based on the artifacts present or missing in that output path.

Recover the latest useful checkpoint for an output folder and continue from there:

```bash
project-brain resume /path/to/repo --output /path/to/output
```

`resume` detects the latest persisted artifact, tells you which stage the project was in, and suggests the most logical next command.

`project-brain ask` now uses the planner profile only for strategic or ambiguous requests, then falls back cleanly if that model is unavailable.
If the user asks to continue or resume, `ask` now reuses the latest saved output state instead of starting from scratch.
When that next step is clear, `ask` now executes one guided continuation stage automatically, for example `swarm -> plan-improvements` or `plan-improvements -> review-delta`.

You can also run a bounded delegated analysis:

```bash
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --output /path/to/output
project-brain swarm "revisa core/swarm_runtime y prioriza mejoras reales" /path/to/repo --output /path/to/output
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 3 --chunk-size 1
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 3 --chunk-size 1 --task-timeout-ms 12000 --max-retries 1
project-brain swarm "ayudame a mejorar este repo" /path/to/repo --parallel 2 --chunk-size 1 --planner-timeout-ms 8000 --synthesis-timeout-ms 8000 --run-timeout-ms 30000 --max-queued-tasks 8
project-brain self-improve /path/to/repo --output /path/to/output
```

Swarm runs now salvage labeled Markdown/text responses from local models when JSON is imperfect, and they honor explicit scope hints in the user intent such as `core/swarm_runtime`.

`swarm` uses the planner to split the request into small tasks, then further shards those tasks into small repo-area chunks for local workers. It writes the merged result to `reports/swarm_run.md`.
By default it adapts parallel workers and queue budget to the local CPU/load/memory profile, uses a round-robin queue so small budgets touch multiple task types first, and can force planner/synthesis onto local models when the run budget is short. In that short-budget mode it also clamps auto-selected concurrency so local workers do not oversubscribe the machine. When a large scoped area times out, the swarm now splits that area into immediate child scopes before retrying instead of re-running the same broad directory. You can override worker count with `--parallel <n>`, force smaller repo slices with `--chunk-size <n>`, set a per-worker budget with `--task-timeout-ms`, cap planner/synthesis/global runtime with `--planner-timeout-ms`, `--synthesis-timeout-ms`, and `--run-timeout-ms`, limit queue growth with `--max-queued-tasks`, and allow bounded retries with `--max-retries`.

`self-improve` is the simplest way to point that swarm back at a repository, including `project-brain` itself, with bounded defaults for local runs while still letting the runtime shrink queue pressure automatically on a busy machine. It also switches the swarm to a `source-first` scope bias so the first chunks prefer product code over `tests/` and dotfiles.

## Prompt-first workflow

The repository now includes reusable templates in `prompts/context_templates/` for:

- frontend analysis
- UX improvement planning
- architecture review
- performance review

These templates are designed to be copied into other repositories or used as context prompts for downstream coding agents.

## Inspiration and attribution

`project-brain` openly credits the projects that influenced specific ideas in its workflow and product design. The goal is to be explicit about inspiration without blurring implementation ownership.

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md).

## Community

If you want to contribute, report problems, or propose new analysis primitives, start with:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- [SUPPORT.md](SUPPORT.md)
- [CITATION.cff](CITATION.cff)
- [docs/github-hardening.md](docs/github-hardening.md)

## Open Source Hardening

`project-brain` is now set up so the public GitHub repo can be opened with stronger defaults:

- local git hooks block weak commit messages, staged secrets, and generated/local-only files
- CI now runs lint, typecheck, build, tests, smoke tests, and a repository safety scan
- GitHub dependency review runs on pull requests
- a weekly security baseline checks repository safety rules and production dependency audit
- `CODEOWNERS` and Dependabot config are committed in-repo

The last mile still lives in GitHub settings, because branch protection and secret-scanning policies cannot be fully enforced from code alone. Use [docs/github-hardening.md](docs/github-hardening.md) after publishing the repository.

## Safety rules

- never modify target repositories automatically
- keep patch proposals review-only
- downgrade weakly corroborated proposals to human review
- never push from generated proposals
- require human approval before implementation
- constrain generated patches to the approved surface area
- classify tasks into `safe-readonly`, `review`, or `edit-limited` policy packs before execution

## Documentation

- [Architecture](docs/architecture.md)
- [Agents](docs/agents.md)
- [Usage](docs/usage.md)
- [External Repository Integration](docs/external-repository-integration.md)
- [Acknowledgements](ACKNOWLEDGEMENTS.md)
