# Limitations

`project-brain` is beta software. The default posture is review-only analysis and artifact generation, not autonomous code modification.

## Repository Support

Fully supported today:

- TypeScript repositories.
- JavaScript repositories, including CommonJS and ESM import graph detection.

Partially supported through file, manifest, and lightweight structure detection:

- Python.
- Go.
- Rust.

Not supported in depth yet:

- Java.
- PHP.
- .NET.

These ecosystems can still appear in repository maps when files or manifests are detected, but deep agent analysis and impact-radius behavior are not equivalent to TypeScript/JavaScript support.

## Review-Only Boundary

Patch proposals are emitted as `.diff` artifacts for human review. `project-brain` does not apply generated patches automatically and does not push generated proposals.

The patch proposal engine confines target reads to the analyzed repository before reading files referenced by generated tasks. This is the runtime guard that supports the review-only security boundary.

## Output Confinement

By default, analysis writes generated artifacts under `BRAIN/` inside the target repository. Use an absolute `--output /path/to/output` when artifacts should be kept outside the target tree.

Generated `AI_CONTEXT/`, runtime `memory/`, `reports/`, `tasks/`, and `patch_proposals/` are output artifacts, not source changes.

## Remote Models

Local Ollama models are preferred for routine analysis. Remote Ollama/cloud routing is allowed by default when configured with `allowRemoteOllama: true`. Disable it with `"allow_remote_ollama": false` in `config/models.json`.
