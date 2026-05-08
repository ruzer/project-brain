# Release candidate 0.2.0

Date: 2026-05-08.

Recommendation: release with warnings.

## 1. Is it ready for internal beta?

Yes. It is ready for internal beta with controlled users and real project validation.

## 2. Is it ready for non-technical users?

Partially. `project-brain go` and `console` are ready for guided testing, but a real non-technical user test is still required before calling it broadly non-technical-ready.

## 3. Is it ready for public beta?

Not yet without warnings. Public beta should wait for remote GitHub Actions and Dependabot refresh.

## 4. Is it ready for commercial sale?

No. Commercial sale needs stronger onboarding, packaging validation, support process, signed/provenance releases, broader OS validation, and more real-world fixtures.

## 5. What is missing by level?

- Internal beta: remote CI confirmation and one human UX test.
- Public beta: Dependabot refresh, GitHub checks green, package dry-run/install smoke.
- Commercial: support, telemetry/metrics, signed releases, enterprise policy, broader compatibility.

## 6. What was validated?

- Backend, frontend, mobile, monorepo, and low-documentation targets.
- `go`, `status`, `resume`, `fact-query`, and `runbook` on all targets.
- `swarm cheap` and `swarm balanced` on representative fixtures.
- Local tests, build, lint, audit, and CLI help during baseline.

## 7. What was not validated?

- `swarm thorough` due cost/time.
- Remote GitHub Actions after the current changes.
- Dependabot alert refresh after the current changes.
- A fresh global install from a packed npm tarball.
- A live non-technical user session.

## 8. Remaining risks

- GitHub may still show stale Dependabot alerts until it rescans.
- Model-heavy outputs vary by provider/model availability.
- Node 20/22 CI matrix must pass remotely.
- Package publishing should be verified with `npm pack --dry-run` before npm release.

## 9. Commands executed

Baseline:

```bash
git status --short
node --version
npm --version
npm run
npm test
npm run build
npm run lint
npm audit
project-brain --help
project-brain go --help
```

Validation matrix:

```bash
project-brain go
project-brain status
project-brain resume
project-brain fact-query
project-brain runbook
project-brain swarm --preset cheap
project-brain swarm --preset balanced
```

## 10. Gate results

- `npm test`: pass, 44 files and 113 tests in baseline.
- `npm run build`: pass in baseline.
- `npm run lint`: pass in baseline.
- `npm audit`: pass in baseline, 0 vulnerabilities.
- Final `npm ci`: pass.
- Final `npm pack --dry-run --json`: pass; package includes `dist/cli/project-brain.js`, docs, `CHANGELOG.md`, and schemas.
- Final `npm audit --audit-level=high`: pass.
- Final CLI smoke: `--help`, `go`, `status`, `resume`, `fact-query`, `runbook`, `doctor`, and `console --help` all passed.

## 11. CI and Dependabot

- Existing GitHub workflows were found.
- CI was hardened for Node 20 and Node 22.
- Main CI now runs `npm audit --audit-level=high`.
- Dependency review now fails high-severity PRs.
- Dependabot is configured for npm and GitHub Actions weekly.

## 12. Docs status

Updated/added documentation covers installation, first run, usage, release checklist, release notes, output contracts, user test script, and commercial hardening backlog.

## 13. Output contract status

Output contracts are documented in `docs/output-contract.md` with schemas for:

- `schemas/repository_fact_graph.schema.json`
- `schemas/preflight_facts.schema.json`
- `schemas/validation_results.schema.json`

## 14. Final recommendation

Release with warnings.

Do not call this public/commercial-ready until remote CI, Dependabot refresh, npm package dry-run, and one non-technical user test are complete.
