import { GENERATED_FILE, REQUIRED_FILES } from "./contract.mjs";
import { assertGeneratedBlock } from "./context.mjs";
import { ensureManagedDirectory, ensureRegularFile, managedPath, pathExists, readText, resolveRoot, writeNewFile } from "./fs.mjs";
import { scanRepository } from "./scanner.mjs";
import { syncRepository } from "./sync.mjs";
import { loadTemplates } from "./templates.mjs";

export async function initRepository(input = ".") {
  const root = await resolveRoot(input, { create: true });
  const existing = [];

  if (await pathExists(managedPath(root, "AI_CONTEXT"))) {
    await ensureManagedDirectory(root, "AI_CONTEXT");
  }

  for (const relativePath of REQUIRED_FILES) {
    const filePath = managedPath(root, relativePath);
    if (await pathExists(filePath)) {
      await ensureRegularFile(filePath);
      if (relativePath === GENERATED_FILE) assertGeneratedBlock(await readText(filePath));
      existing.push(relativePath);
    }
  }

  // Descubre problemas de lectura antes de publicar una parte del contrato.
  await scanRepository(root);

  const templates = await loadTemplates();
  const created = [];
  await ensureManagedDirectory(root, "AI_CONTEXT", { create: true });
  for (const relativePath of REQUIRED_FILES) {
    if (existing.includes(relativePath)) continue;
    await writeNewFile(managedPath(root, relativePath), templates.get(relativePath));
    created.push(relativePath);
  }

  const synced = await syncRepository(root);
  return { root, created, preserved: existing, changed: synced.changed, facts: synced.facts };
}
