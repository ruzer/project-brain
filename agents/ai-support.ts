import path from "node:path";
import { readFileSync } from "node:fs";

import { readTextSafe, uniqueSorted } from "../shared/fs-utils";
import type { ProjectContext, RiskLevel } from "../shared/types";

export interface AgentAIIssue {
  severity: string;
  description: string;
}

export interface AgentAIImprovement {
  type: string;
  proposal: string;
}

export interface AgentAIResponse {
  issues: AgentAIIssue[];
  proposed_improvements: AgentAIImprovement[];
}

function resolveProjectBrainRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, "package.json");

    try {
      const content = readFileSync(candidate, "utf8");
      const parsed = JSON.parse(content) as { name?: string };
      if (parsed.name === "project-brain") {
        return current;
      }
    } catch {
      // keep walking
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

export async function loadAgentSystemPrompt(fileName: string): Promise<string> {
  const root = resolveProjectBrainRoot(__dirname);
  const promptPath = path.join(root, "agents", "prompts", fileName);
  return readTextSafe(promptPath);
}

export function buildRepoSummary(context: ProjectContext): string {
  const { discovery } = context;
  return [
    `Repository: ${context.repoName}`,
    `Languages: ${discovery.languages.join(", ") || "Unknown"}`,
    `Frameworks: ${discovery.frameworks.join(", ") || "Unknown"}`,
    `APIs: ${discovery.apis.join(", ") || "Not detected"}`,
    `Infrastructure: ${discovery.infrastructure.join(", ") || "Not detected"}`,
    `Testing: ${discovery.testing.join(", ") || "Not detected"}`,
    `CI/CD: ${discovery.ci.providers.join(", ") || "Not detected"}`,
    `Top-level directories: ${discovery.structure.topLevelDirectories.join(", ") || "Unknown"}`,
    `Source files: ${discovery.structure.sourceFileCount}`,
    `Test files: ${discovery.structure.testFileCount}`,
    `Recommendations: ${discovery.recommendations.join(" | ") || "None"}`
  ].join("\n");
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

export function parseAgentAIResponse(raw: string): AgentAIResponse | undefined {
  const normalized = stripMarkdownFences(raw);
  const objectStart = normalized.indexOf("{");
  const objectEnd = normalized.lastIndexOf("}");
  const candidate = objectStart >= 0 && objectEnd > objectStart ? normalized.slice(objectStart, objectEnd + 1) : normalized;

  try {
    const parsed = JSON.parse(candidate) as Partial<AgentAIResponse>;
    return {
      issues: (parsed.issues ?? []).filter(
        (issue): issue is AgentAIIssue => Boolean(issue && typeof issue.description === "string")
      ),
      proposed_improvements: (parsed.proposed_improvements ?? []).filter(
        (improvement): improvement is AgentAIImprovement => Boolean(improvement && typeof improvement.proposal === "string")
      )
    };
  } catch {
    return undefined;
  }
}

export function normalizeAIInsight(issue: AgentAIIssue): string {
  const severity = issue.severity?.trim().toLowerCase() || "medium";
  return `[${severity.toUpperCase()}] ${issue.description.trim()}`;
}

export function normalizeAIImprovement(improvement: AgentAIImprovement): string {
  const type = improvement.type?.trim();
  return type ? `${type}: ${improvement.proposal.trim()}` : improvement.proposal.trim();
}

export function combineRecommendations(...lists: string[][]): string[] {
  return uniqueSorted(
    lists
      .flat()
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

export function mergeRiskLevel(base: RiskLevel, aiIssues: AgentAIIssue[]): RiskLevel {
  if (base === "high") {
    return base;
  }

  if (aiIssues.some((issue) => issue.severity?.toLowerCase() === "high")) {
    return "high";
  }

  if (base === "medium" || aiIssues.some((issue) => issue.severity?.toLowerCase() === "medium")) {
    return "medium";
  }

  return "low";
}
