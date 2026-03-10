import { BaseAgent } from "../base-agent";

import type { AgentEvaluation, ProjectContext } from "../../shared/types";

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock"
];

export class SecurityAgent extends BaseAgent {
  constructor() {
    super("security-agent", "security_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const { discovery } = context;

    const riskyFiles = discovery.files.filter(
      (file) =>
        /(^|\/)\.env($|[^/])/.test(file) ||
        /\.(pem|key)$/i.test(file) ||
        /id_rsa|credentials|secret/i.test(file)
    ).filter((file) => !/\.example$|\.sample$|\.template$/i.test(file));

    if (riskyFiles.length > 0) {
      findings.push(`Potential secret-bearing files detected: ${riskyFiles.slice(0, 5).join(", ")}.`);
      recommendations.push("Review secret material, move sensitive values to a vault, and add defensive ignore rules.");
    }

    if (discovery.dependencies.length > 0 && !LOCKFILES.some((lockfile) => discovery.files.includes(lockfile))) {
      findings.push("Dependency manifests exist without a lockfile, weakening supply-chain reproducibility.");
      recommendations.push("Commit the appropriate lockfile or checksum manifest for deterministic installs.");
    }

    if (discovery.infrastructure.includes("Dockerfile") && !discovery.files.includes(".dockerignore")) {
      findings.push("Dockerfile detected without a .dockerignore, increasing image leakage risk.");
      recommendations.push("Add a .dockerignore to exclude secrets, VCS metadata, and build noise.");
    }

    return {
      title: "Security Report",
      summary: "SecurityAgent evaluated secret exposure and dependency hygiene signals.",
      findings,
      recommendations,
      riskLevel: riskyFiles.length > 0 ? "high" : findings.length > 0 ? "medium" : "low"
    };
  }
}
