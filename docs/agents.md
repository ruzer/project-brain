# agents

`project-brain` uses specialist agents with constrained responsibilities.

## Core analysis agents

- `QAAgent`: test gaps, bug risk, release confidence
- `UXAgent`: operational usability analysis
- `UXImprovementAgent`: implementation-task generation for UX changes
- `ArchitectureAgent`: boundaries, coupling, and structural risk
- `OptimizationAgent`: performance and efficiency review
- `DocumentationAgent`: documentation gaps and operational clarity
- `DevAgent`: review-only engineering task and patch proposal generation

## Supporting agents

- `ProductOwnerAgent`
- `SecurityAgent`
- `DependencyAgent`
- `ObservabilityAgent`
- `LegalAgent`

## Agent safety contract

All agents are constrained to:

- analyze
- propose
- report

They must not:

- modify target repositories automatically
- deploy code
- push changes
- bypass human review

## Prompt handling

Runtime system prompts remain under `agents/prompts/` for compatibility with the current implementation.

Reusable exported prompts for other repositories live under `prompts/context_templates/`.
