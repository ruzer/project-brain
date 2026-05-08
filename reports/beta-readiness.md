# Beta readiness

Status: release with warnings.

## Ready for internal beta

Yes. The product is stable enough for internal beta validation with real projects.

Evidence:

- Local test/build/lint/audit gates passed in baseline.
- Five representative target types were validated.
- Core deterministic CLI commands passed across all targets.
- `swarm cheap` and `swarm balanced` passed on representative small targets with bounded timeouts.
- Runtime outputs were written to isolated `.tmp/beta-validation` directories.
- Output contracts and installation docs are now documented.

## Not ready for public beta without warnings

Remaining blockers/warnings:

- GitHub Actions must pass remotely after push.
- Dependabot alerts must refresh and confirm no fixable high/moderate vulnerabilities remain.
- A real non-technical user test has not yet been executed.
- `swarm thorough` has not been validated in this release candidate.

## Not ready for commercial sale

Commercial readiness still needs:

- signed releases or provenance
- broader OS validation
- stronger onboarding polish
- support process
- more real-world fixtures
- optional metrics/telemetry
