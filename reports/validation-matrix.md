# Beta validation matrix

Validation date: 2026-05-08.

Output root used locally: `.tmp/beta-validation/`.

## Targets

| ID | Type | Target | Rationale | Recommendation |
|---|---|---|---|---|
| `backend_large` | Backend large | `<external-fixture>/backend_denuncia` | Real backend with package manifest and multiple app areas | pass |
| `frontend_modern` | Frontend modern | `<external-fixture>/Frontend_Denuncia` | Real frontend project | pass |
| `mobile` | Mobile | `<external-fixture>/AppDenunciaenLinea` | Real Flutter mobile app (`pubspec.yaml`) | pass |
| `monorepo` | Monorepo/workspace | `tests/fixtures/multi-repo-workspace` | Representative multi-project fixture | pass |
| `docs_poor` | Low documentation | `tests/fixtures/dev-agent-repo` | Minimal fixture for structure-first analysis | pass |

## Commands per target

Each target ran:

```bash
project-brain go "<intent>" <target> --output <out>
project-brain status <target> --output <out>
project-brain resume <target> --output <out>
project-brain fact-query "<factual question>" <target> --output <out>
project-brain runbook "<intent>" <target> --output <out>
```

Additional bounded swarm checks:

```bash
project-brain swarm "extrae hallazgos generales sin modificar archivos" tests/fixtures/dev-agent-repo --preset cheap --parallel 1 --max-queued-tasks 1 --max-retries 1 --run-timeout-ms 25000
project-brain swarm "resume paquetes principales sin modificar archivos" tests/fixtures/multi-repo-workspace --preset balanced --parallel 1 --max-queued-tasks 1 --max-retries 1 --run-timeout-ms 25000
```

`thorough` was not executed because the beta gate is focused on stability and the time/model cost was not justified.

## Evaluation criteria

| Criterion | Result |
|---|---|
| Detects repo structure | pass |
| Generates `MEMORY_BRIEF` | pass |
| Generates `EXECUTIVE_SUMMARY` | pass |
| Generates fact graph | pass |
| `fact-query` works without model-heavy flow | pass |
| `preflightFacts` remains first deterministic gate | pass by existing tests and go/runbook flow |
| Distinguishes fresh/stale memory | pass by regression tests |
| Executive summary is useful for unfamiliar users | warning: needs live user test |
| Review-only behavior avoids target file writes | pass; outputs were isolated in `.tmp/beta-validation` |
| Swarm incremental adds value | warning: cheap/balanced pass, quality should be reviewed by humans on larger projects |
