# CI Status Report

## Pipeline

- Workflow: `project-brain-ci`
- Platform: GitHub Actions
- Triggers:
  - `push`
  - `pull_request`

## Quality gates

The pipeline runs the following stages in order:

1. checkout
2. install dependencies
3. build
4. typecheck
5. run tests
6. run smoke tests
7. generate reports

## Failure conditions

The workflow fails if any of the following commands fail:

- `npm run build`
- `npm run typecheck`
- `npm run test`
- `npm run test:smoke`

## Merge protection intent

When this workflow is used as a required status check in GitHub branch protection, failing tests or smoke tests block merge.

## Generated CI artifacts

The workflow uploads these reports as build artifacts:

- `reports/ci_status_report.md`
- `reports/test_baseline_report.md`
- `reports/test_coverage_initial.md`

## Outcome

This pipeline establishes a minimal but strict CI gate so proposed changes must pass build, typecheck, automated tests, and smoke workflows before acceptance.
