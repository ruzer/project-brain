# usage

## Build

```bash
npm install
npm run build
```

## Validate locally

```bash
npm run typecheck
npm test
```

## Analyze a repository

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

## Typical ERP-GOB workflow

Frontend usability cycle:

```bash
project-brain analyze \
  "/Users/ruzer/ProyectosLocales/ERP/Sistema Unificado/erp-gob-frontend" \
  --output "/Users/ruzer/ProyectosLocales/Agentes/pb-output/erp-gob-frontend" \
  --trigger repository-change \
  --ollama-timeout 240000 \
  --verbose
```

Workspace-wide analysis:

```bash
project-brain analyze \
  "/Users/ruzer/ProyectosLocales/ERP/Sistema Unificado" \
  --output "/Users/ruzer/ProyectosLocales/Agentes/pb-output/erp-gob-workspace" \
  --trigger repository-change
```

## Prompt template usage

The templates in `prompts/context_templates/` are intended for external repositories. Use them when a coding agent needs high-quality context before proposing frontend, UX, architecture, or performance changes.

Recommended process:

1. Run `project-brain analyze` against the target repository.
2. Collect the generated `AI_CONTEXT`, reports, and task artifacts.
3. Combine those artifacts with one of the prompt templates.
4. Use the resulting context in the downstream coding agent.

## Common commands

```bash
project-brain init /path/to/repo
project-brain agents /path/to/repo
project-brain weekly /path/to/repo
project-brain report /path/to/output
project-brain models
```

## Safety

`project-brain` analyzes and proposes. It does not modify target code automatically. Generated patch proposals remain review-only.
