# project-brain

`project-brain` is a modular TypeScript engine for analyzing software repositories, building durable project context, running specialist agents, and generating non-destructive recommendations.

## What it does

- Scans repository structure, languages, frameworks, APIs, infrastructure, dependencies, and testing signals
- Creates persistent `AI_CONTEXT` memory for the analyzed project
- Runs a hierarchy of specialist agents coordinated by a `ChiefAgent`
- Adds an `Agent Self-Governance System` with task planning, agent supervision, learnings, proposals, and structured inter-agent messaging
- Produces reports for product, QA, security, observability, legal, optimization, documentation, and development concerns
- Generates weekly and risk reports without changing the target codebase

## Principles

- Never modify target code automatically
- Understand the project before acting
- Persist context and learned findings
- Keep decisions, rules, errors, and learnings visible
- Stay portable across stacks and repository layouts

## Repository layout

```text
project-brain/
  core/
    orchestrator/
    discovery_engine/
    context_builder/
    scheduler/
  agents/
  analysis/
  memory/
  tools/
  integrations/
  reports/templates/
  cli/
  docs/
```

## Installation

```bash
npm install
npm run build
```

## Validation

```bash
npm run typecheck
npm test
```

## Local AI runtime

`project-brain` uses Ollama for offline inference. The Ollama request timeout is configurable and defaults to `180000` ms (3 minutes).

Timeout precedence is:

- `project-brain analyze --ollama-timeout <ms>`
- `OLLAMA_TIMEOUT_MS`
- `config/models.json` -> `ollama_timeout_ms`
- built-in default: `180000`

Example:

```bash
project-brain analyze /path/to/repo --ollama-timeout 240000
```

CI is defined in [.github/workflows/ci.yml](/Users/ruzer/ProyectosLocales/Agentes/.github/workflows/ci.yml) and runs install, typecheck, build, and tests.

## CLI

```bash
project-brain init /path/to/repo
project-brain analyze /path/to/repo
project-brain analyze /path/to/repo --ollama-timeout 240000
project-brain agents /path/to/repo
project-brain weekly /path/to/repo
project-brain report /path/to/repo
project-brain feedback /path/to/repo --agent qa-agent --task <taskId> --context "..." --problem "..." --action "..." --outcome SUCCESSFUL_PROPOSAL
```

All commands accept `--output <dir>`. By default, output is written into the target repository so `AI_CONTEXT`, `reports`, and generated `docs` live with the analyzed project.

## Example

```bash
node dist/cli/project-brain.js analyze /Users/me/ERP-GOB
```

To extend Ollama inference time for larger repositories:

```bash
node dist/cli/project-brain.js analyze /Users/me/ERP-GOB --ollama-timeout 240000
```

Expected outputs inside the target repository:

- `AI_CONTEXT/PROJECT_MODEL.md`
- `AI_CONTEXT/ARCHITECTURE_MAP.md`
- `AI_CONTEXT/API_MAP.md`
- `AI_CONTEXT/DEPENDENCY_GRAPH.md`
- `AI_CONTEXT/STACK_PROFILE.md`
- `AI_CONTEXT/AGENTS.md`
- `AI_CONTEXT/ARCHITECTURE.md`
- `AI_CONTEXT/CONTEXT.md`
- `AI_CONTEXT/RULES.md`
- `AI_CONTEXT/ERRORS.md`
- `AI_CONTEXT/DECISIONS.md`
- `AI_CONTEXT/TASKS.md`
- `AI_CONTEXT/STYLE_GUIDE.md`
- `AI_CONTEXT/LEARNINGS.md`
- `reports/weekly_system_report.md`
- `reports/risk_report.md`
- `reports/improvement_proposals.md`
- `reports/agent_activity_report.md`
- `reports/improvement_report.md`
- `docs/architecture.md`
- `docs/api.md`
- `docs/runbook.md`
- `tasks/backlog.json`
- `tasks/active.json`
- `tasks/completed.json`
- `tasks/messages.json`
- `memory/learnings/index.json`
- `proposal/improved_<agent>.md`

## Architecture

See [docs/architecture.md](/Users/ruzer/ProyectosLocales/Agentes/docs/architecture.md), [docs/usage.md](/Users/ruzer/ProyectosLocales/Agentes/docs/usage.md), and [docs/agent-self-governance.md](/Users/ruzer/ProyectosLocales/Agentes/docs/agent-self-governance.md).
