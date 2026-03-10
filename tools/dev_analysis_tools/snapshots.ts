import path from "node:path";

import { readTextSafe, uniqueSorted } from "../../shared/fs-utils";
import { hasErrorHandling, hasLogging, isTypeOnlyModule, requiresErrorHandling } from "./contracts";
import type { SourceSnapshot } from "./contracts";

export async function loadSnapshots(targetPath: string, sourceFiles: string[]): Promise<SourceSnapshot[]> {
  const duplicateCounts = new Map<string, number>();
  const windowOwners = new Map<string, Set<string>>();

  const snapshots = await Promise.all(
    sourceFiles.map(async (filePath) => {
      const content = await readTextSafe(path.join(targetPath, filePath));

      return {
        filePath,
        content,
        lineCount: content.split(/\r?\n/).length,
        duplicateBlocks: 0,
        hasStructuredLogging: hasLogging(content),
        hasErrorHandling: hasErrorHandling(content),
        requiresErrorHandling: requiresErrorHandling(content),
        isTypeOnlyModule: isTypeOnlyModule(content)
      };
    })
  );

  for (const snapshot of snapshots) {
    const normalizedLines = snapshot.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith("import ") &&
          !line.startsWith("//") &&
          !line.startsWith("*") &&
          line.length >= 12
      );

    for (let index = 0; index <= normalizedLines.length - 4; index += 1) {
      const block = normalizedLines.slice(index, index + 4);
      if (block.join("").length < 80) {
        continue;
      }

      const key = block.join("\n");
      if (!windowOwners.has(key)) {
        windowOwners.set(key, new Set());
      }
      windowOwners.get(key)?.add(snapshot.filePath);
    }
  }

  for (const owners of windowOwners.values()) {
    if (owners.size < 2) {
      continue;
    }

    for (const filePath of owners) {
      duplicateCounts.set(filePath, (duplicateCounts.get(filePath) ?? 0) + 1);
    }
  }

  return snapshots.map((snapshot) => ({
    ...snapshot,
    duplicateBlocks: duplicateCounts.get(snapshot.filePath) ?? 0
  }));
}

export function findDuplicationClusters(snapshots: SourceSnapshot[]) {
  const blockOwners = new Map<string, Set<string>>();

  for (const snapshot of snapshots) {
    const normalizedLines = snapshot.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line &&
          !line.startsWith("import ") &&
          !line.startsWith("//") &&
          !line.startsWith("*") &&
          line.length >= 12
      );

    for (let index = 0; index <= normalizedLines.length - 4; index += 1) {
      const block = normalizedLines.slice(index, index + 4);
      if (block.join("").length < 80) {
        continue;
      }

      const key = block.join("\n");
      if (!blockOwners.has(key)) {
        blockOwners.set(key, new Set());
      }
      blockOwners.get(key)?.add(snapshot.filePath);
    }
  }

  return [...blockOwners.entries()]
    .map(([sample, filePaths]) => ({
      sample,
      filePaths: uniqueSorted([...filePaths]),
      occurrences: filePaths.size
    }))
    .filter((cluster) => cluster.filePaths.length > 1)
    .sort((left, right) => right.occurrences - left.occurrences || right.sample.length - left.sample.length)
    .slice(0, 5);
}
