# Contributing to project-brain

Thanks for contributing.

## Before opening an issue

- Confirm the behavior on the current `main` branch.
- Include the exact command you ran, the target repository shape, and the generated artifact or report that looks wrong.
- If the problem is really a feature request, say what workflow it unlocks and why the current commands are not enough.

## Before opening a pull request

- Keep `project-brain` non-destructive. Changes must not automatically modify analyzed target repositories.
- Prefer deterministic analysis and explicit artifacts over opaque behavior.
- If you add or change a CLI command, update the README, `docs/usage.md`, and tests.
- If you adapt code or file content from another project, preserve its license notices and document the source clearly.

## Development checklist

Run these before asking for review:

```bash
npm run hooks:install
npm run lint
npm run typecheck
npm run build
npm run test
npm run test:smoke
```

Local hooks now block:

- weak commit messages like `wip` or `tmp`
- accidental secrets in staged changes
- generated or local-only paths such as `dist/`, `sample-output/`, `pb-output/`, `.env*`
- pushes that fail the quick verification gate

If hooks are missing after cloning, run `npm run hooks:install`.

## Pull request expectations

Each PR should explain:

- what problem it solves
- the commands or flows affected
- how it was validated
- whether documentation changed
- whether any upstream project influenced the implementation

## Good first contributions

- improve repository discovery signals
- add analyzers for more ecosystems
- improve report quality without making execution destructive
- add tests for edge cases in generated context or governance flows
