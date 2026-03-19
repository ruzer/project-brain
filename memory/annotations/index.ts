import path from "node:path";

import { ensureDir, readJsonSafe, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type { ContextAnnotation } from "../../shared/types";

function annotationsDir(outputPath: string): string {
  return path.join(outputPath, "memory", "annotations");
}

function annotationsIndexPath(outputPath: string): string {
  return path.join(annotationsDir(outputPath), "index.json");
}

function annotationsArtifactPath(outputPath: string): string {
  return path.join(outputPath, "AI_CONTEXT", "ANNOTATIONS.md");
}

function sortAnnotations(annotations: ContextAnnotation[]): ContextAnnotation[] {
  return [...annotations].sort((left, right) => left.scope.localeCompare(right.scope));
}

function renderAnnotations(annotations: ContextAnnotation[]): string {
  if (annotations.length === 0) {
    return "# ANNOTATIONS\n\n- None recorded.\n";
  }

  return `# ANNOTATIONS

${annotations
  .map(
    (annotation) => `## ${annotation.scope}

- Updated: ${annotation.updatedAt}
- Created: ${annotation.createdAt}

${annotation.note}
`
  )
  .join("\n")}`.trimEnd() + "\n";
}

export async function listContextAnnotations(outputPath: string): Promise<ContextAnnotation[]> {
  const annotations = (await readJsonSafe<ContextAnnotation[]>(annotationsIndexPath(outputPath))) ?? [];
  return sortAnnotations(annotations);
}

export async function readContextAnnotation(
  outputPath: string,
  scope: string
): Promise<ContextAnnotation | undefined> {
  const annotations = await listContextAnnotations(outputPath);
  return annotations.find((annotation) => annotation.scope === scope);
}

export async function writeAnnotationsArtifact(
  outputPath: string,
  annotations?: ContextAnnotation[]
): Promise<string> {
  const resolvedAnnotations = annotations ?? (await listContextAnnotations(outputPath));
  const artifactPath = annotationsArtifactPath(outputPath);
  await writeFileEnsured(artifactPath, renderAnnotations(resolvedAnnotations));
  return artifactPath;
}

export async function writeContextAnnotation(
  outputPath: string,
  scope: string,
  note: string
): Promise<ContextAnnotation> {
  const existing = await listContextAnnotations(outputPath);
  const previous = existing.find((annotation) => annotation.scope === scope);
  const timestamp = new Date().toISOString();
  const nextAnnotation: ContextAnnotation = {
    scope,
    note,
    createdAt: previous?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
  const remaining = existing.filter((annotation) => annotation.scope !== scope);
  const nextAnnotations = sortAnnotations([...remaining, nextAnnotation]);

  await ensureDir(annotationsDir(outputPath));
  await writeJsonEnsured(annotationsIndexPath(outputPath), nextAnnotations);
  await writeAnnotationsArtifact(outputPath, nextAnnotations);

  return nextAnnotation;
}

export async function clearContextAnnotation(outputPath: string, scope: string): Promise<boolean> {
  const existing = await listContextAnnotations(outputPath);
  const nextAnnotations = existing.filter((annotation) => annotation.scope !== scope);

  if (nextAnnotations.length === existing.length) {
    await writeAnnotationsArtifact(outputPath, existing);
    return false;
  }

  await ensureDir(annotationsDir(outputPath));
  await writeJsonEnsured(annotationsIndexPath(outputPath), nextAnnotations);
  await writeAnnotationsArtifact(outputPath, nextAnnotations);
  return true;
}
