# GitHub hardening

`project-brain` can be published openly now, but the repository settings still need a final hardening pass in GitHub.

## What is already committed in-repo

- `CODEOWNERS` for sensitive paths
- local git hooks for commit, push, and commit-message gates
- CI quality gates
- dependency review workflow
- security baseline workflow
- Dependabot config

## GitHub settings to enable manually

Apply these rules to the `main` branch:

1. Require a pull request before merging.
2. Require at least one approval.
3. Require review from code owners.
4. Dismiss stale approvals when new commits are pushed.
5. Require conversation resolution before merge.
6. Require these status checks:
   - `quality-gates`
   - `dependency-review`
   - `security-baseline`
7. Block force pushes.
8. Block branch deletion.

If a repository clone stays private on a limited GitHub plan, branch protection may be unavailable.
In that case, either make the repository public before opening contributions or upgrade the plan that owns the repository.

Recommended repository-wide settings:

1. Enable private vulnerability reporting.
2. Enable Dependabot alerts and Dependabot security updates.
3. Enable secret scanning and push protection if your GitHub plan supports them.
4. Require approval for first-time workflow runs from forks.
5. Keep GitHub Actions permissions at the lowest level that still lets CI pass.
6. Prefer squash merge so history stays reviewable.

On limited private plans, secret scanning may stay unavailable until the repository is public or the plan is upgraded.

## Local contributor flow

After cloning:

```bash
npm install
npm run hooks:install
npm run verify
```

## What the local gates block

- weak commit messages like `wip` or `tmp`
- accidental secrets in staged changes
- generated or local-only paths like `dist/`, `sample-output/`, `pb-output/`, and `.env*`
- pushes that fail lint, typecheck, or build

## Limits

No committed file can fully enforce:

- branch protection
- repository permissions
- secret scanning policy
- who can merge or bypass checks

Those still have to be turned on in GitHub settings by a repository admin.
