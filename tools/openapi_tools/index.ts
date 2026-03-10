import path from "node:path";

import { readTextSafe } from "../../shared/fs-utils";

export function findOpenApiFiles(files: string[]): string[] {
  return files.filter((file) => {
    const lower = file.toLowerCase();
    const base = path.posix.basename(lower);
    const isSpecName = base.includes("openapi") || base.includes("swagger") || base.includes("api-spec");
    const isSpecExtension = [".yml", ".yaml", ".json"].some((extension) => lower.endsWith(extension));
    return isSpecName && isSpecExtension;
  });
}

export async function summarizeOpenApiFiles(
  rootPath: string,
  files: string[]
): Promise<Array<{ path: string; title?: string; version?: string }>> {
  const summaries: Array<{ path: string; title?: string; version?: string }> = [];

  for (const file of files) {
    const content = await readTextSafe(path.join(rootPath, file));
    const title = content.match(/title:\s*["']?([^\n"']+)["']?/i)?.[1];
    const version = content.match(/version:\s*["']?([^\n"']+)["']?/i)?.[1];
    summaries.push({ path: file, title, version });
  }

  return summaries;
}
