# ERP-GOB integration

`project-brain` is used with ERP-GOB as an external intelligence layer.

## Primary use cases

- generate analysis prompts for coding agents
- generate implementation backlog from real repository structure
- generate review-only patch proposals
- build durable context before any manual code change

## What it should do

- analyze ERP-GOB frontend and backend repositories
- produce `AI_CONTEXT` artifacts
- generate UX, architecture, QA, and optimization reports
- generate task backlogs and review-only diffs

## What it must not do

- modify ERP-GOB code automatically
- change backend logic without explicit human direction
- push code to remote repositories
- bypass review or validation

## Recommended workflow

1. Run `project-brain analyze` against the ERP-GOB target.
2. Review `AI_CONTEXT`, reports, and task outputs.
3. Select the relevant prompt template from `prompts/context_templates/`.
4. Provide the generated context plus the template to the downstream coding agent.
5. Review any patch proposals manually before implementation.

## Common ERP-GOB artifacts

- `UX_IMPLEMENTATION_TASKS.md`
- `NAVIGATION_RESTRUCTURE.md`
- `FORM_SIMPLIFICATION_TASKS.md`
- `WORKSPACE_IMPROVEMENTS.md`
- `patch_proposals/*.diff`

These artifacts are intended to accelerate human-reviewed implementation work, not to replace it.
