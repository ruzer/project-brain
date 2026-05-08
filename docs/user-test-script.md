# Non-technical user test script

## User profile

A product owner, technical lead, analyst, or manager who needs to understand a project but does not know internal `project-brain` commands.

The only instruction given to the user is:

```bash
project-brain go
```

## Tasks

1. Start `project-brain go`.
2. Analyze a project.
3. Find the executive summary.
4. Search for one factual answer about the project.
5. Review pending or recommended next steps.
6. Choose a cheap/review-only analysis path if offered.
7. Exit without needing help.

## Observation questions

- Did the user understand what to do first?
- Did the user know where output was written?
- Did the user find the executive summary?
- Did any text feel too technical?
- Did the user understand cheap/balanced/thorough?
- Did the user trust the result? Why or why not?
- Did the user expect project files to be modified?
- Did the user know how to stop or exit?

## Success criteria

- Completes first analysis without help.
- Finds `AI_CONTEXT/EXECUTIVE_SUMMARY.md`.
- Runs or understands factual search.
- Understands cheap/balanced/thorough at a basic cost level.
- Knows that output is review-only and generated separately.
- Does not need to read the full README before starting.

## Backlog classification

- P0: blocks first analysis or causes fear of data loss.
- P1: confuses the user but allows progress.
- P2: improves clarity or polish.

## Notes for facilitator

Do not explain internal commands. Record where the user hesitates and the exact text that caused confusion.
