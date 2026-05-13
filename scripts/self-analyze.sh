#!/bin/bash
set -e

node dist/cli/project-brain.js start "analiza y mejora project-brain" . --output ./BRAIN
node dist/cli/project-brain.js fact-query "workflow registry orchestrator swarm" . --output ./BRAIN
node dist/cli/project-brain.js swarm "identifica deuda técnica y módulos sin tests" . \
  --output ./BRAIN --preset balanced
node dist/cli/project-brain.js plan-improvements . --output ./BRAIN
