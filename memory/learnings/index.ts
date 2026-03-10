import path from "node:path";

import { readJsonSafe, writeJsonEnsured } from "../../shared/fs-utils";
import { StructuredLogger } from "../../shared/logger";
import type { LearningOutcome, LearningRecord } from "../../shared/types";

function createLessonId(agentId: string): string {
  return `lesson_${agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface LearningFeedbackInput {
  agentId: string;
  taskId: string;
  context: string;
  detectedProblem: string;
  actionTaken: string;
  outcome: LearningOutcome;
  confidenceScore: number;
}

export interface RepeatedLearningPattern {
  detectedProblem: string;
  count: number;
  agentIds: string[];
}

export class AgentLearningStore {
  private readonly logger = new StructuredLogger("agent-learning-store");

  async loadAll(learningDir: string): Promise<LearningRecord[]> {
    return (await readJsonSafe<LearningRecord[]>(path.join(learningDir, "index.json"))) ?? [];
  }

  async appendBatch(learningDir: string, records: LearningRecord[]): Promise<void> {
    const existing = await this.loadAll(learningDir);
    const merged = [...existing, ...records];
    const runFileName = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

    await writeJsonEnsured(path.join(learningDir, runFileName), records);
    await writeJsonEnsured(path.join(learningDir, "index.json"), merged);
    this.logger.info("Persisted learning records", {
      component: "memory",
      action: "memory_write",
      learningDir,
      records: records.length
    });
  }

  createRecord(input: LearningFeedbackInput): LearningRecord {
    return {
      lessonId: createLessonId(input.agentId),
      agentId: input.agentId,
      taskId: input.taskId,
      context: input.context,
      detectedProblem: input.detectedProblem,
      actionTaken: input.actionTaken,
      outcome: input.outcome,
      confidenceScore: input.confidenceScore,
      createdAt: new Date().toISOString()
    };
  }

  findRepeatedPatterns(records: LearningRecord[]): RepeatedLearningPattern[] {
    const patterns = new Map<string, { count: number; agentIds: Set<string> }>();

    for (const record of records) {
      const key = record.detectedProblem.trim().toLowerCase();
      if (!key) {
        continue;
      }

      if (!patterns.has(key)) {
        patterns.set(key, { count: 0, agentIds: new Set<string>() });
      }

      const entry = patterns.get(key);
      if (!entry) {
        continue;
      }

      entry.count += 1;
      entry.agentIds.add(record.agentId);
    }

    return [...patterns.entries()]
      .filter(([, value]) => value.count > 1)
      .map(([detectedProblem, value]) => ({
        detectedProblem,
        count: value.count,
        agentIds: [...value.agentIds].sort((left, right) => left.localeCompare(right))
      }))
      .sort((left, right) => right.count - left.count || left.detectedProblem.localeCompare(right.detectedProblem));
  }
}
