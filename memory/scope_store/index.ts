import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { ensureDir, readJsonSafe, uniqueSorted, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  ProjectContext,
  ScopeMemoryFileHash,
  ScopeMemoryLookupResult,
  ScopeMemoryRecord,
  SwarmRunResult,
  SwarmWorkerResult
} from "../../shared/types";

const MAX_HASHED_FILES_PER_SCOPE = 80;

function normalizeScope(scope: string): string {
  const normalized = scope.trim().replace(/^\.\/+/, "").replace(/\/+$/, "");
  return normalized || ".";
}

function scopeKey(scope: string): string {
  return Buffer.from(normalizeScope(scope)).toString("base64url");
}

function scopeMemoryDir(context: ProjectContext): string {
  return path.join(context.runtimeMemoryDir, "scopes");
}

export function scopeMemoryPath(context: ProjectContext, scope: string): string {
  return path.join(scopeMemoryDir(context), `${scopeKey(scope)}.json`);
}

function filesForScope(context: ProjectContext, scope: string): string[] {
  const normalized = normalizeScope(scope);
  return normalized === "."
    ? context.discovery.files
    : context.discovery.files.filter((file) => file === normalized || file.startsWith(`${normalized}/`));
}

function hashedFilesForScope(context: ProjectContext, scope: string): string[] {
  return filesForScope(context, scope).slice(0, MAX_HASHED_FILES_PER_SCOPE);
}

function mergeMemoryItems(previous: string[] | undefined, next: string[], limit: number): string[] {
  return uniqueSorted([...(previous ?? []), ...next].map((item) => item.trim()).filter(Boolean)).slice(0, limit);
}

function scopedWorkerScopes(context: ProjectContext, workerResults: SwarmWorkerResult[]): string[] {
  const scopesFromWorkers = workerResults.flatMap((worker) => worker.scopePaths.map(normalizeScope));
  if (scopesFromWorkers.length > 0) {
    return scopesFromWorkers;
  }

  return context.discovery.structure.topLevelDirectories;
}

function scopeFileStats(context: ProjectContext, scope: string): { totalCount: number; hashTruncated: boolean } {
  const totalCount = filesForScope(context, scope).length;
  return {
    totalCount,
    hashTruncated: totalCount > MAX_HASHED_FILES_PER_SCOPE
  };
}

function normalizeRecordFreshness(context: ProjectContext, record: ScopeMemoryRecord): Promise<ScopeMemoryRecord> {
  return hashScopeFiles(context, record.scope).then((currentHashes) => ({
    ...record,
    freshness: compareFreshness(record, currentHashes)
  }));
}

async function hashFile(context: ProjectContext, relativePath: string): Promise<ScopeMemoryFileHash> {
  try {
    const content = await fs.readFile(path.join(context.targetPath, relativePath));
    return {
      path: relativePath,
      sha256: createHash("sha256").update(content).digest("hex")
    };
  } catch {
    return {
      path: relativePath,
      missing: true
    };
  }
}

async function hashScopeFiles(context: ProjectContext, scope: string): Promise<ScopeMemoryFileHash[]> {
  return Promise.all(hashedFilesForScope(context, scope).map((file) => hashFile(context, file)));
}

function compareFreshness(
  existing: ScopeMemoryRecord,
  currentHashes: ScopeMemoryFileHash[]
): ScopeMemoryRecord["freshness"] {
  const previousHashes = existing.files?.hashed ?? [];
  const previous = new Map(previousHashes.map((file) => [file.path, file]));
  const currentPaths = new Set(currentHashes.map((file) => file.path));
  const changedFiles: string[] = [];
  const missingFiles: string[] = [];
  let unchangedFiles = 0;

  for (const current of currentHashes) {
    const old = previous.get(current.path);
    if (current.missing) {
      missingFiles.push(current.path);
      continue;
    }
    if (!old?.sha256 || old.sha256 !== current.sha256) {
      changedFiles.push(current.path);
      continue;
    }
    unchangedFiles += 1;
  }

  for (const previousFile of previousHashes) {
    if (!currentPaths.has(previousFile.path)) {
      missingFiles.push(previousFile.path);
    }
  }

  return {
    status: changedFiles.length > 0 || missingFiles.length > 0 ? "stale" : "fresh",
    changedFiles,
    missingFiles,
    unchangedFiles
  };
}

async function readScopeMemory(context: ProjectContext, scope: string): Promise<ScopeMemoryRecord | undefined> {
  return readJsonSafe<ScopeMemoryRecord>(scopeMemoryPath(context, scope));
}

export async function loadScopeMemoryRecords(
  context: ProjectContext,
  scopes: string[]
): Promise<ScopeMemoryLookupResult> {
  const uniqueScopes = uniqueSorted(scopes.map(normalizeScope));
  const records: ScopeMemoryRecord[] = [];
  let hits = 0;
  let misses = 0;
  let stale = 0;

  for (const scope of uniqueScopes) {
    const existing = await readScopeMemory(context, scope);
    if (!existing) {
      misses += 1;
      continue;
    }

    const currentHashes = await hashScopeFiles(context, scope);
    const freshness = compareFreshness(existing, currentHashes);
    const record: ScopeMemoryRecord = {
      ...existing,
      freshness
    };

    if (freshness.status === "fresh") {
      hits += 1;
    } else {
      stale += 1;
    }

    records.push(record);
  }

  return {
    records,
    hits,
    misses,
    stale
  };
}

export async function listScopeMemoryRecords(context: ProjectContext): Promise<ScopeMemoryRecord[]> {
  try {
    const entries = await fs.readdir(scopeMemoryDir(context));
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readJsonSafe<ScopeMemoryRecord>(path.join(scopeMemoryDir(context), entry)))
    );
    return Promise.all(
      records
        .filter((record): record is ScopeMemoryRecord => Boolean(record))
        .map((record) => normalizeRecordFreshness(context, record))
    );
  } catch {
    return [];
  }
}

function mergeWorkerItems(
  workerResults: SwarmWorkerResult[],
  scope: string,
  selector: (result: SwarmWorkerResult) => string[] | undefined,
  limit: number
): string[] {
  return uniqueSorted(
    workerResults
      .filter((result) => result.status === "completed")
      .filter((result) => result.scopePaths.map(normalizeScope).includes(normalizeScope(scope)))
      .flatMap((result) => selector(result) ?? [])
      .map((item) => item.trim())
      .filter(Boolean)
  ).slice(0, limit);
}

function workersForScope(workerResults: SwarmWorkerResult[], scope: string): SwarmWorkerResult[] {
  return workerResults.filter((result) => result.scopePaths.map(normalizeScope).includes(normalizeScope(scope)));
}

function coverageForScope(workerResults: SwarmWorkerResult[], scope: string): ScopeMemoryRecord["coverage"] {
  const workers = workersForScope(workerResults, scope);
  const completedWorkers = workers.filter((worker) => worker.status === "completed").length;
  const failedWorkers = workers.filter((worker) => worker.status === "failed").length;
  const timedOutWorkers = workers.filter((worker) => worker.status === "timed_out").length;
  const status =
    completedWorkers > 0 && failedWorkers === 0 && timedOutWorkers === 0
      ? "complete"
      : completedWorkers > 0
        ? "partial"
        : timedOutWorkers > 0
          ? "timed_out"
          : "failed";

  return {
    status,
    workerTaskIds: workers.map((worker) => worker.taskId),
    completedWorkers,
    failedWorkers,
    timedOutWorkers
  };
}

export async function writeScopeMemoryFromSwarmResult(context: ProjectContext, result: SwarmRunResult): Promise<number> {
  const scopes = uniqueSorted(scopedWorkerScopes(context, result.workerResults));
  await ensureDir(scopeMemoryDir(context));

  let writes = 0;
  for (const scope of scopes) {
    const previous = await readScopeMemory(context, scope);
    const hashes = await hashScopeFiles(context, scope);
    const stats = scopeFileStats(context, scope);
    const verifiedFacts = mergeWorkerItems(result.workerResults, scope, (worker) => worker.verifiedFacts, 16);
    const unknowns = mergeWorkerItems(result.workerResults, scope, (worker) => worker.unknowns, 12);
    const evidenceRefs = mergeWorkerItems(result.workerResults, scope, (worker) => worker.evidenceRefs, 16);
    const nextActions = mergeWorkerItems(result.workerResults, scope, (worker) => worker.recommendations, 10);

    const record: ScopeMemoryRecord = {
      version: 1,
      repoName: context.repoName,
      targetPath: context.targetPath,
      scope,
      scopeKey: scopeKey(scope),
      updatedAt: new Date().toISOString(),
      generatedBy: {
        command: "swarm",
        intent: result.intent,
        provider: result.synthesis.provider,
        model: result.synthesis.model
      },
      files: {
        count: hashes.length,
        totalCount: stats.totalCount,
        hashTruncated: stats.hashTruncated,
        hashed: hashes
      },
      coverage: coverageForScope(result.workerResults, scope),
      freshness: {
        status: "fresh",
        changedFiles: [],
        missingFiles: hashes.filter((file) => file.missing).map((file) => file.path),
        unchangedFiles: hashes.filter((file) => file.sha256).length
      },
      decisions: mergeMemoryItems(previous?.decisions, [`Swarm analyzed scope "${scope}" for intent: ${result.intent}`], 12),
      verifiedFacts: mergeMemoryItems(previous?.verifiedFacts, verifiedFacts, 24),
      unknowns: mergeMemoryItems(previous?.unknowns, unknowns, 18),
      evidenceRefs: mergeMemoryItems(previous?.evidenceRefs, evidenceRefs, 24),
      nextActions: mergeMemoryItems(previous?.nextActions, nextActions, 16),
      sourceArtifacts: mergeMemoryItems(previous?.sourceArtifacts, [result.reportPath, result.memoryPath, ...evidenceRefs], 32)
    };

    await writeJsonEnsured(scopeMemoryPath(context, scope), record);
    writes += 1;
  }

  return writes;
}

export function renderScopeMemoryForPrompt(records: ScopeMemoryRecord[]): string {
  if (records.length === 0) {
    return "Scope memory: None available for this chunk.";
  }

  return [
    "Scope memory from previous runs:",
    ...records.map((record) =>
      [
        `- Scope: ${record.scope}`,
        `  Freshness: ${record.freshness.status}`,
        `  Coverage: ${record.coverage?.status ?? "unknown"}`,
        `  Hashed files: ${record.files?.count ?? record.files?.hashed?.length ?? 0}/${record.files?.totalCount ?? record.files?.count ?? "unknown"}${record.files?.hashTruncated ? " (truncated)" : ""}`,
        `  Generated by: ${record.generatedBy?.command ?? "unknown"} (${record.generatedBy?.model ?? "unknown model"})`,
        `  Verified facts: ${record.verifiedFacts.slice(0, 5).join(" | ") || "None"}`,
        `  Unknowns: ${record.unknowns.slice(0, 4).join(" | ") || "None"}`,
        `  Evidence: ${record.evidenceRefs.slice(0, 4).join(" | ") || "None"}`
      ].join("\n")
    )
  ].join("\n");
}
