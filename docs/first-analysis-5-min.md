# First analysis in 5 minutes

This path is for a user who only wants to understand a repository safely.

## 1. Install and build

```bash
cd /path/to/project-brain
npm ci
npm run build
npm link
```

## 2. Run the guided entry point

```bash
project-brain go "understand this project and suggest the next safe step" /path/to/target-repo --output /tmp/project-brain-first-run
```

## 3. Read the executive summary

Open:

```text
/tmp/project-brain-first-run/AI_CONTEXT/EXECUTIVE_SUMMARY.md
```

## 4. Ask a factual question without spending model tokens

```bash
project-brain fact-query "what frameworks does this repo use" /path/to/target-repo --output /tmp/project-brain-first-run
```

Read:

```text
/tmp/project-brain-first-run/reports/fact_query.md
```

## 5. Continue from the latest checkpoint

```bash
project-brain resume /path/to/target-repo --output /tmp/project-brain-first-run
```

## 6. Optional review-only swarm

Start cheap. Move to balanced only when the summary shows unresolved areas.

```bash
project-brain swarm "review the main risks without modifying files" /path/to/target-repo --output /tmp/project-brain-first-run/swarm-cheap --preset cheap
```

`project-brain` is review-only by default: it writes analysis artifacts to the output directory and does not modify the target repository.
