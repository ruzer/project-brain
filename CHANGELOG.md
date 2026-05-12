# Changelog

## 0.2.3 - 2026-05-12

### Added

- `project-brain new` seeds new projects with guided `AI_CONTEXT`, architecture docs, project memory, initial backlog, and `CLAUDE.md`.
- Interactive and non-interactive project seed inputs cover archetype, audience, stack, features, auth, roles, data entities, integrations, priority, and language.

### Changed

- Package metadata, README, and output contract are aligned with the `v0.2.3` release.

## 0.2.2 - 2026-05-12

### Changed

- README now includes direct run instructions from source, compiled `dist`, and optional `npm link`.
- CLI version reporting now reads from package metadata instead of a hardcoded string.

### Fixed

- Package metadata, lockfile, README, and output contract are aligned for the `v0.2.2` release.

## 0.2.1 - 2026-05-12

### Added

- `project-brain architecture-plan` generates an evidence-backed architecture blueprint, evolution state, agent context, and compact JSON memory.
- Default CLI output now writes to `BRAIN/` under the target repository when `--output` is omitted.

### Fixed

- CLI, package metadata, lockfile, README, and output contract versions now align with the `v0.2.1` release tag.

## 0.2.0 - 2026-05-08

### Added

- Progressive memory release path with `MEMORY_BRIEF`, scoped memory, `EXECUTIVE_SUMMARY`, and repository fact graph artifacts.
- `preflightFacts` as the deterministic memory/facts gate before expensive analysis paths.
- Guided `project-brain go` entry point for beta users.
- Bounded swarm presets: `cheap`, `balanced`, and `thorough`.
- Runtime artifact policy for generated local outputs, diagnostics, and templates.
- Output contract documentation and JSON schemas for key consumable artifacts.
- Beta validation reports covering backend, frontend, mobile, monorepo, and low-documentation repositories.

### Changed

- Package version is prepared as `0.2.0` for an internal beta/release candidate.
- CI is prepared to run on Node 20 and Node 22.
- Package metadata now declares Node `>=20`, publishable files, and a `prepack` build step.
- Documentation now leads users through `project-brain go` before advanced commands.

### Fixed

- Local `npm audit` is clean after dependency lockfile updates.
- Runtime artifacts are isolated from source-controlled project state.
- Memory regression tests cover stale scope memory, deleted files, truncated hash tracking, dedupe, stale fact-query behavior, and real executive summary scopes.

### Security

- `npm audit` reports zero local vulnerabilities.
- CI includes `npm audit --audit-level=high` in the main quality gate.
- Dependency review fails pull requests with high-severity dependency issues.

### Tests

- Full local test suite passes: 44 files, 113 tests.
- Release smoke validation covers `go`, `status`, `resume`, `fact-query`, `runbook`, and bounded swarm presets on representative targets.

### Docs

- Added installation, first-analysis, output-contract, user-test, release checklist, release notes, commercial hardening backlog, beta readiness, and release candidate reports.

### Known limitations

- GitHub Dependabot may need to refresh alerts after lockfile changes are pushed.
- `swarm thorough` was not executed in beta validation because cost/time was not justified for release-candidate gating.
- Model-heavy behavior depends on local Ollama or configured cloud/API providers.
- This is not a commercial 1.0 release; it is an internal beta/release candidate.
