import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const fixtureRepoPath = path.resolve(currentDir, "fixtures/sample-repo");
export const devAgentFixtureRepoPath = path.resolve(currentDir, "fixtures/dev-agent-repo");
export const workspaceFixturePath = path.resolve(currentDir, "fixtures/multi-repo-workspace");

export async function createTempOutputDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

export async function cleanupDir(dirPath: string): Promise<void> {
  await rm(dirPath, { recursive: true, force: true });
}
