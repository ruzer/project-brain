import path from "node:path";

import { fileExists, readJsonSafe } from "../../shared/fs-utils";
import type { MemoryBriefDocument } from "../memory_brief";
import type { MemoryReadinessResult, ProjectContext } from "../../shared/types";

const DEFAULT_MAX_AGE_HOURS = 72;

function ageHours(generatedAt: string | undefined): number | undefined {
  if (!generatedAt) {
    return undefined;
  }
  const timestamp = Date.parse(generatedAt);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return Number(((Date.now() - timestamp) / 3_600_000).toFixed(2));
}

export async function assessMemoryReadiness(
  context: ProjectContext,
  options: { maxAgeHours?: number } = {}
): Promise<MemoryReadinessResult> {
  const maxAgeHours = options.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS;
  const memoryBriefPath = path.join(context.memoryDir, "MEMORY_BRIEF.md");
  const memoryBriefJsonPath = path.join(context.runtimeMemoryDir, "memory_brief", "memory_brief.json");
  const hasMarkdown = await fileExists(memoryBriefPath);
  const hasJson = await fileExists(memoryBriefJsonPath);

  if (!hasMarkdown || !hasJson) {
    return {
      status: "missing",
      memoryBriefPath,
      memoryBriefJsonPath,
      maxAgeHours,
      factsCount: 0,
      evidenceCount: 0,
      tokenGuidanceCount: 0,
      reason: "MEMORY_BRIEF markdown or JSON artifact is missing."
    };
  }

  const brief = await readJsonSafe<MemoryBriefDocument>(memoryBriefJsonPath);
  if (!brief) {
    return {
      status: "invalid",
      memoryBriefPath,
      memoryBriefJsonPath,
      maxAgeHours,
      factsCount: 0,
      evidenceCount: 0,
      tokenGuidanceCount: 0,
      reason: "MEMORY_BRIEF JSON could not be parsed."
    };
  }

  const factsCount = brief.recentVerifiedFacts.length;
  const evidenceCount = brief.evidenceRefs.length;
  const tokenGuidanceCount = brief.tokenGuidance.length;
  const currentAgeHours = ageHours(brief.generatedAt);

  if (!brief.repoName || !brief.generatedAt) {
    return {
      status: "invalid",
      memoryBriefPath,
      memoryBriefJsonPath,
      generatedAt: brief.generatedAt,
      ageHours: currentAgeHours,
      maxAgeHours,
      factsCount,
      evidenceCount,
      tokenGuidanceCount,
      reason: "MEMORY_BRIEF is missing required identity fields."
    };
  }

  if (factsCount < 1 || evidenceCount < 1 || tokenGuidanceCount < 1) {
    return {
      status: "invalid",
      memoryBriefPath,
      memoryBriefJsonPath,
      generatedAt: brief.generatedAt,
      ageHours: currentAgeHours,
      maxAgeHours,
      factsCount,
      evidenceCount,
      tokenGuidanceCount,
      reason: "MEMORY_BRIEF does not meet the minimum factual schema."
    };
  }

  if (currentAgeHours !== undefined && currentAgeHours > maxAgeHours) {
    return {
      status: "stale",
      memoryBriefPath,
      memoryBriefJsonPath,
      generatedAt: brief.generatedAt,
      ageHours: currentAgeHours,
      maxAgeHours,
      factsCount,
      evidenceCount,
      tokenGuidanceCount,
      reason: `MEMORY_BRIEF is older than ${maxAgeHours} hours.`
    };
  }

  return {
    status: "ready",
    memoryBriefPath,
    memoryBriefJsonPath,
    generatedAt: brief.generatedAt,
    ageHours: currentAgeHours,
    maxAgeHours,
    factsCount,
    evidenceCount,
    tokenGuidanceCount,
    reason: "MEMORY_BRIEF is present, fresh, factual, and evidence-backed."
  };
}
