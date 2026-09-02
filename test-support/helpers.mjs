import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryRepository(t, name = "brain-test-") {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export async function put(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export function get(root, relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}
