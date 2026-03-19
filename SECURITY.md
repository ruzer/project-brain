# Security Policy

## Supported versions

Security fixes are expected on the latest state of `main`.

## Reporting a vulnerability

- Do not open a public issue for an exploitable vulnerability.
- Prefer GitHub private vulnerability reporting if it is enabled for this repository.
- If private reporting is not available, contact the maintainer directly through GitHub with a minimal reproduction, impact summary, and affected files or commands.

## Scope

Please report issues such as:

- command injection or unsafe shell execution
- unsafe file writes or path traversal in generated artifacts
- leakage of secrets or credentials in reports, logs, or generated context
- unsafe agent behavior that could cause destructive repository changes

Non-sensitive hardening suggestions can still be opened as normal issues.

## Baseline controls

The repository now includes:

- local `pre-commit`, `pre-push`, and `commit-msg` hooks
- repository safety scanning for staged changes and CI
- GitHub dependency review on pull requests
- a security baseline workflow with production dependency audit
- `CODEOWNERS` for sensitive areas

Branch protection, required reviews, secret scanning, and GitHub private vulnerability reporting still need to be enabled in the repository settings. See `docs/github-hardening.md`.
