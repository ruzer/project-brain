# Installation

## Requirements

- Node.js `>=20`
- npm
- Git
- macOS or Linux for the current beta validation path
- Ollama optional for local model-heavy analysis
- Cloud/API provider optional for planner or advanced model-heavy workflows

## Install from source

```bash
git clone <project-brain-repo-url>
cd project-brain
npm ci
npm run build
```

Run the CLI from source:

```bash
node dist/cli/project-brain.js --help
```

Optionally link it as a local command:

```bash
npm link
project-brain --help
```

## Validate the install

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=high
project-brain --help
project-brain go --help
```

## Mode without external models

Deterministic workflows still work without Ollama or cloud/API access:

- `go`
- `status`
- `resume`
- `runbook`
- `fact-query`
- `code-graph`
- `harness-audit`
- `doctor`

These commands use repository scanning, generated memory, fact graph, and preflight facts before any model-heavy path.

## Mode with Ollama

Check whether Ollama is available:

```bash
ollama list
project-brain models
```

Typical local models are configured by role. If a model is missing, model-heavy commands should degrade with a clear error or fallback rather than breaking deterministic commands.

Use memory-first commands before model-heavy swarm to reduce cost:

```bash
project-brain go "understand this project" /path/to/repo --output /path/to/output
project-brain fact-query "what framework does this repo use" /path/to/repo --output /path/to/output
project-brain swarm "review risky areas" /path/to/repo --output /path/to/output --preset cheap
```

## Mode with cloud/API providers

Cloud/API providers are optional and should be reserved for ambiguous planning or synthesis that deterministic memory cannot answer. Configure provider environment variables according to your local router setup, then run:

```bash
project-brain models
project-brain swarm "review architecture risks" /path/to/repo --output /path/to/output --preset balanced
```

Always prefer `go`, `status`, `resume`, `runbook`, and `fact-query` before broad model-heavy analysis.
