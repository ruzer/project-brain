import { GENERATED_FILE } from "./contract.mjs";
import { replaceGeneratedBlock } from "./context.mjs";
import { ensureManagedDirectory, managedPath, readTextSnapshot, resolveRoot, writeFileAtomic } from "./fs.mjs";
import { scanRepository } from "./scanner.mjs";

async function runSync(input = ".", beforeAtomicWrite) {
  const root = await resolveRoot(input);
  await ensureManagedDirectory(root, "AI_CONTEXT");
  const contextPath = managedPath(root, GENERATED_FILE);
  const before = await readTextSnapshot(contextPath);
  const facts = await scanRepository(root);
  await ensureManagedDirectory(root, "AI_CONTEXT");
  const current = await readTextSnapshot(contextPath);
  if (!current.bytes.equals(before.bytes)) {
    throw new Error("CONTEXT.md cambió durante la sincronización; vuelve a intentarlo.");
  }
  const after = replaceGeneratedBlock(current.text, facts);
  const changed = after !== before.text;
  if (changed && beforeAtomicWrite) await beforeAtomicWrite();
  if (changed) {
    await writeFileAtomic(root, contextPath, after, { expectedBytes: current.bytes });
  }
  return { root, changed, facts };
}

export function syncRepository(input = ".") {
  return runSync(input);
}

export const __testing = Object.freeze({
  syncWithCheckpoint(input, checkpoint) {
    return runSync(input, checkpoint);
  }
});
