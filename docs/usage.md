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
node dist/cli/project-brain.js analyze /path/to/repo
```

Ollama inference defaults to `180000` ms (3 minutes). Override it for heavier AI analysis runs:

```bash
node dist/cli/project-brain.js analyze /path/to/repo --ollama-timeout 240000
```

With governance trigger selection:

```bash
node dist/cli/project-brain.js analyze /path/to/repo --trigger weekly-review
```

You can also set the timeout outside the CLI:

```bash
OLLAMA_TIMEOUT_MS=240000 node dist/cli/project-brain.js analyze /path/to/repo
```

If neither the CLI flag nor the environment variable is set, `project-brain` reads `ollama_timeout_ms` from [/Users/ruzer/ProyectosLocales/Agentes/config/models.json](/Users/ruzer/ProyectosLocales/Agentes/config/models.json) and falls back to `180000`.

## Initialize memory only

```bash
node dist/cli/project-brain.js init /path/to/repo
```

## Run the agents suite

```bash
node dist/cli/project-brain.js agents /path/to/repo
```

## Generate weekly artifacts

```bash
node dist/cli/project-brain.js weekly /path/to/repo
```

## Record human learning feedback

```bash
node dist/cli/project-brain.js feedback /path/to/repo \
  --agent qa-agent \
  --task task_qa-agent_123 \
  --context "Weekly review validation" \
  --problem "No automated tests detected" \
  --action "Escalated smoke-test baseline proposal" \
  --outcome SUCCESSFUL_PROPOSAL
```

## Show generated artifacts

```bash
node dist/cli/project-brain.js report /path/to/repo
```

If you want to keep generated output outside the target repository, add `--output /separate/folder`.
