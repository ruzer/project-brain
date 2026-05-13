import path from "node:path";

import { readTextSafe, writeFileEnsured } from "../../shared/fs-utils";
import type { ProjectContext } from "../../shared/types";

type ContextFieldValue = string | string[] | undefined;

function compact(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function contextFile(context: ProjectContext, fileName: string): string {
  return path.join(context.memoryDir, fileName);
}

async function appendUniqueLine(filePath: string, text: string): Promise<void> {
  const normalized = compact(text);
  if (!normalized) {
    return;
  }

  const current = await readTextSafe(filePath);
  const existing = new Set(
    current
      .split(/\r?\n/)
      .map((line) => compact(line.replace(/^[-*]\s+/, "")))
      .filter(Boolean)
  );
  if (existing.has(normalized)) {
    return;
  }

  const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
  await writeFileEnsured(filePath, `${prefix}- ${normalized}\n`);
}

function renderField(value: ContextFieldValue): string {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter(Boolean);
    return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- UNKNOWN";
  }

  const text = compact(value ?? "");
  return text.length > 0 ? text : "UNKNOWN";
}

function titleFromKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export async function appendLearning(context: ProjectContext, text: string): Promise<void> {
  await appendUniqueLine(contextFile(context, "LEARNINGS.md"), text);
}

export async function appendError(context: ProjectContext, text: string): Promise<void> {
  await appendUniqueLine(contextFile(context, "ERRORS.md"), text);
}

export async function updateContext(context: ProjectContext, fields: Record<string, ContextFieldValue>): Promise<void> {
  const filePath = contextFile(context, "CONTEXT.md");
  const sections = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `## ${titleFromKey(key)}\n\n${renderField(value)}`)
    .join("\n\n");

  await writeFileEnsured(
    filePath,
    `# CONTEXT\n\n${sections}\n`
  );
}
