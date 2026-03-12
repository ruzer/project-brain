# project-brain

`project-brain` is a non-destructive repository analysis engine for software systems and AI-assisted engineering workflows. It analyzes target repositories, builds durable context, runs specialist agents, generates reports, and produces review-only patch proposals.

The current primary use case is external repository analysis for ERP-GOB, especially:

- frontend usability analysis
- architecture review
- backlog generation
- context prompt generation for downstream coding agents

`project-brain` never applies code changes automatically to the target repository.

## What it does

- scans repositories and workspaces
- builds `AI_CONTEXT` memory artifacts
- runs specialist agents for QA, UX, architecture, optimization, documentation, and development review
- generates backlog-style implementation tasks
- produces review-only patch proposals for human approval
- exports reusable prompt templates for external repositories such as ERP-GOB

## Architecture

Current runtime flow:

```text
CLI -> Orchestrator -> Discovery -> Context Builder -> Agents -> Reports -> Patch Proposals
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
npm run typecheck
npm test
```

## Typical usage

Analyze a repository in place:

```bash
project-brain analyze /path/to/repo
```

Keep generated artifacts outside the target repository:

```bash
project-brain analyze /path/to/repo --output /path/to/output
```

Analyze ERP-GOB frontend with local AI routing:

```bash
project-brain analyze \
  "/Users/ruzer/ProyectosLocales/ERP/Sistema Unificado/erp-gob-frontend" \
  --output "/Users/ruzer/ProyectosLocales/Agentes/pb-output/erp-gob-frontend" \
  --trigger repository-change \
  --ollama-timeout 240000 \
  --verbose
```

## Local AI runtime

`project-brain` supports local inference through Ollama and can operate offline when local models are available.

Timeout precedence:

1. `project-brain analyze --ollama-timeout <ms>`
2. `OLLAMA_TIMEOUT_MS`
3. `config/models.json -> ollama_timeout_ms`
4. built-in default: `180000`

Inspect configured models:

```bash
project-brain models
```

## Prompt-first workflow

The repository now includes reusable templates in `prompts/context_templates/` for:

- frontend analysis
- UX improvement planning
- architecture review
- performance review

These templates are designed to be copied into other repositories or used as context prompts for coding agents working on ERP-GOB.

## Safety rules

- never modify target repositories automatically
- keep patch proposals review-only
- never push from generated proposals
- require human approval before implementation
- constrain generated patches to the approved surface area

## Documentation

- [Architecture](/Users/ruzer/ProyectosLocales/Agentes/docs/architecture.md)
- [Agents](/Users/ruzer/ProyectosLocales/Agentes/docs/agents.md)
- [Usage](/Users/ruzer/ProyectosLocales/Agentes/docs/usage.md)
- [ERP-GOB Integration](/Users/ruzer/ProyectosLocales/Agentes/docs/erp-gob-integration.md)
