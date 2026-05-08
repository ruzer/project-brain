# Final tag gate 0.2.0

Date: 2026-05-08.

Final recommendation: release with warnings.

## 1. Final state

`project-brain` 0.2.0 is ready to commit and push as an internal beta release candidate.

It is not ready to tag until remote GitHub Actions and Dependabot refresh are confirmed after push.

## 2. Pre-commit review

### package.json

Status: pass.

- `version`: `0.2.0`.
- `bin.project-brain`: `dist/cli/project-brain.js`.
- `engines.node`: `>=20`.
- `prepack`: `npm run build`.
- `files` includes runtime CLI output, docs, prompts, templates, schemas, and changelog.
- Runtime noise is not included in the package files list.

### package-lock.json

Status: pass.

Changes are coherent with `package.json`:

- root version changed to `0.2.0`.
- root engines added.
- `@types/node` aligned to Node 20 support.
- no suspicious runtime dependency changes were observed in the reviewed diff.

### Workflows

Status: pass locally, pending remote execution.

- `project-brain-ci.yml` runs on Node 20 and Node 22.
- `project-brain-ci.yml` runs `npm ci`, lint, build, typecheck, tests, smoke tests, audit high, and repo safety.
- `security-baseline.yml` runs on Node 20 and Node 22.
- `dependency-review.yml` fails on high severity.
- No workflow secrets are required by the changed jobs.

### Reports policy

Status: pass.

The following reports are deliberately versioned release evidence:

- `reports/validation-matrix.md`
- `reports/validation-results.json`
- `reports/beta-readiness.md`
- `reports/release-candidate-0.2.0.md`
- `reports/final-tag-gate-0.2.0.md`

Runtime ad hoc reports remain ignored by policy, for example `reports/doctor.md`.

### Schemas

Status: pass.

Validated as JSON:

- `schemas/repository_fact_graph.schema.json`
- `schemas/preflight_facts.schema.json`
- `schemas/validation_results.schema.json`
- `reports/validation-results.json`

### Docs

Status: pass.

Docs are consistent with “internal beta stable with warnings”:

- `docs/installation.md`
- `docs/first-analysis-5-min.md`
- `docs/user-test-script.md`
- `docs/output-contract.md`
- `docs/backlog-commercial-hardening.md`
- `docs/release-checklist.md`
- `docs/releases/0.2.0.md`
- `README.md`
- `docs/usage.md`
- `AI_REVIEW_START_HERE.md`
- `CHANGELOG.md`

## 3. Local reproducible validation

Environment:

- Local Node: `v25.9.0`.
- Local npm: `11.12.1`.
- `nvm`, `volta`, `asdf`, and `fnm`: not available locally.

Result table:

| Command | Result |
|---|---|
| `npm ci` | pass |
| `npm test` | pass |
| `npm run build` | pass |
| `npm run lint` | pass |
| `npm audit --audit-level=high` | pass |
| `npm pack --dry-run --json` | pass |
| `node dist/cli/project-brain.js --help` | pass |
| `node dist/cli/project-brain.js go --help` | pass |
| `node dist/cli/project-brain.js status . --output .tmp/final-gate/self` | pass |
| `node dist/cli/project-brain.js resume . --output .tmp/final-gate/self` | pass |
| `node dist/cli/project-brain.js fact-query "qué versión tiene este paquete" . --output .tmp/final-gate/self` | pass |
| `node dist/cli/project-brain.js runbook "release final gate" . --output .tmp/final-gate/self` | pass |
| `node dist/cli/project-brain.js doctor . --output .tmp/final-gate/self` | pass |
| `node dist/cli/project-brain.js console --help` | pass |

## 4. Tarball clean install gate

Status: pass.

Procedure executed:

```bash
npm pack --pack-destination .tmp/tarball-gate
mkdir temporary install directory under /tmp
npm init -y
npm install <repo>/.tmp/tarball-gate/project-brain-0.2.0.tgz
npx project-brain --help
npx project-brain go --help
npx project-brain status . --output <tmp>/out
npx project-brain doctor . --output <tmp>/out
```

Evidence:

- Tarball installed successfully.
- `npx project-brain --help` passed.
- `npx project-brain go --help` passed.
- `npx project-brain status` passed.
- `npx project-brain doctor` passed.
- `node_modules/project-brain/dist/cli/project-brain.js` exists.
- `node_modules/project-brain/docs/output-contract.md` exists.
- `node_modules/project-brain/schemas/preflight_facts.schema.json` exists.

## 5. Secret/runtime safety review

Status: pass with notes.

No intended commit command should include:

- `node_modules/`
- `.tmp/`
- `.claude/`
- `.env`
- private keys
- credentials
- ad hoc runtime doctor reports

Large files observed under `.tmp/` and existing generated output paths are not part of the recommended `git add` command.

## 6. GitHub remote gate

Status: blocked by Node 20 timeout failure.

Original failed run:

- Workflow: `project-brain-ci`
- Run: `25575315699`
- SHA: `c27439f25a81663a67a91f8ca280ffd67840519f`
- Failed job: `quality-gates (20)`
- Passing job: `quality-gates (22)`

Rerun status:

- `gh run rerun 25575315699 --failed` was executed.
- `quality-gates (20)` failed again.
- This is not treated as a one-off flake.

Observed failures:

- `tests/integration/dev-agent-analysis.test.ts`: default `5000ms` timeout was too low on Node 20 CI; observed runtime was about `5171ms`.
- `tests/smoke/cli-workflows.test.ts`: explicit `15000ms` timeout was too low on Node 20 CI; observed runtime was about `16976ms`.

Cause:

- Node 20 GitHub runner executes the full suite more slowly than local Node 25 and Node 22 CI. The failures are timeout budget issues in two integration/smoke tests, not assertion failures and not product behavior failures.

Fix:

- Add a specific `15000ms` timeout to `tests/integration/dev-agent-analysis.test.ts`.
- Increase only the affected first CLI smoke workflow timeout to `45000ms`.
- No product code, package version, CLI behavior, assertions, or workflow matrix were changed.

Post-fix local validation:

| Command | Result |
|---|---|
| `npm test -- tests/integration/dev-agent-analysis.test.ts` | pass |
| `npm test -- tests/smoke/cli-workflows.test.ts` | pass |
| `npm test` | pass, 44 files and 113 tests |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm audit --audit-level=high` | pass, 0 vulnerabilities |

Post-fix remote validation:

- PR workflow result: pass on PR `#16` before this report update.
- PR checks observed as passing:
  - `dependency-review`
  - `quality-gates (20)`
  - `quality-gates (22)`
  - `security-baseline (20)`
  - `security-baseline (22)`
- PR merge status: blocked by base branch policy, not by test failure.
- Auto-merge was enabled with squash merge because merge commits are not allowed in this repository.
- Main workflow result after merge: pending.
- Dependabot state after merge: pending.

Post-push checklist:

- `project-brain-ci.yml` passes on Node 20.
- `project-brain-ci.yml` passes on Node 22.
- `security-baseline.yml` passes on Node 20.
- `security-baseline.yml` passes on Node 22.
- `dependency-review.yml` does not block without reason.
- CI artifacts upload without name collision.
- Dependabot npm alerts refresh.
- Dependabot GitHub Actions alerts refresh.
- No high/moderate vulnerability remains when a non-risky fix is available.
- Branch protection required checks match the release process.

## 7. Tag criteria

Allow `v0.2.0` only if all are true:

- commit is created
- push is complete
- GitHub Actions are green remotely
- Dependabot has no high/moderate fixable alerts without risky major upgrades
- tarball clean install remains green
- no secrets or runtime noise are included
- release notes and changelog are present

Block tag if any are true:

- remote CI fails
- Node 20 or Node 22 tests fail
- `npm audit` finds high/moderate fixable issues
- tarball install fails
- CLI bin is broken
- `dist` is missing from package
- secrets or credentials are included

## 8. Risk classification

### BLOCKER

None found locally.

### WARNING

- Remote GitHub Actions are pending until push.
- Dependabot alert refresh is pending until push/GitHub rescan.
- Local validation used Node `v25.9.0`; Node 20/22 validation is delegated to CI because no local version manager is available.
- `swarm thorough` was not executed because cost/time was not justified for this gate.
- Non-technical user test has been prepared but not executed.

### BACKLOG

- Public beta polish.
- Commercial packaging/signing/provenance.
- Broader OS validation.
- Optional telemetry/metrics.
- More real-world fixtures.

## 9. Commit plan

Recommended add command:

```bash
git add .github package.json package-lock.json README.md AI_REVIEW_START_HERE.md docs reports schemas CHANGELOG.md
```

Recommended commit:

```bash
git commit -m "chore(release): prepare 0.2.0 beta candidate"
```

Recommended push after commit:

```bash
git push origin main
```

Do not tag until the remote gate passes.

## 10. Operational decision

Decision: can commit and push.

Decision: do not tag yet.

Final recommendation: release with warnings.
