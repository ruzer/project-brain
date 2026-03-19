# External repository integration

`project-brain` is designed to work as an external intelligence layer for repositories it does not own.

## Primary use cases

- generate analysis prompts for coding agents
- generate implementation backlog from real repository structure
- generate review-only patch proposals
- build durable context before any manual code change

## What it should do

- analyze frontend, backend, and workspace repositories
- produce `AI_CONTEXT` artifacts
- generate UX, architecture, QA, and optimization reports
- generate task backlogs and review-only diffs

## What it must not do

- modify target code automatically
- change production logic without explicit human direction
- push code to remote repositories
- bypass review or validation

## Recommended workflow

1. Run `project-brain analyze` against the target repository.
2. Review `AI_CONTEXT`, reports, and task outputs.
3. Select the relevant prompt template from `prompts/context_templates/`.
4. Provide the generated context plus the template to the downstream coding agent.
5. Review any patch proposals manually before implementation.

## Common artifacts

- `UX_IMPLEMENTATION_TASKS.md`
- `NAVIGATION_RESTRUCTURE.md`
- `FORM_SIMPLIFICATION_TASKS.md`
- `WORKSPACE_IMPROVEMENTS.md`
- `patch_proposals/*.diff`

These artifacts are intended to accelerate human-reviewed implementation work, not to replace it.
