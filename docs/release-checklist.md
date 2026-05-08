# Release checklist

Use this checklist before tagging `v0.2.0`.

## Local gates

- [ ] `git status` contains only intended release changes.
- [ ] `npm ci` passes.
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npm audit --audit-level=high` passes.
- [ ] `npm run security:repo` passes.
- [ ] `npm pack --dry-run` includes `dist/cli/project-brain.js`.

## CLI smoke

- [ ] `project-brain --help` works.
- [ ] `project-brain go --help` works.
- [ ] `project-brain status <target> --output <out>` works.
- [ ] `project-brain resume <target> --output <out>` works.
- [ ] `project-brain fact-query "<repo fact>" <target> --output <out>` works.
- [ ] `project-brain runbook "<intent>" <target> --output <out>` works.
- [ ] `project-brain doctor <target> --output <out>` works when environment allows.
- [ ] `project-brain console --help` works without interaction.

## Remote gates

- [ ] GitHub Actions are green on Node 20.
- [ ] GitHub Actions are green on Node 22.
- [ ] Dependency review is green.
- [ ] Dependabot has no high/moderate alerts that are fixable without risky major upgrades.
- [ ] Required branch protections match the release process.

## Release

- [ ] `CHANGELOG.md` is updated.
- [ ] `docs/releases/0.2.0.md` is updated.
- [ ] `reports/release-candidate-0.2.0.md` is updated.
- [ ] Maintainer approves tag creation.
- [ ] Tag `v0.2.0` is created and pushed.
