import { GENERATED_FILE } from "./contract.mjs";
import { replaceGeneratedBlock } from "./context.mjs";
import {
  ensureManagedDirectory,
  managedPath,
  readManagedTextSnapshot,
  resolveRoot,
  sameFilesystemIdentity,
  writeFileAtomic
} from "./fs.mjs";
import { scanRepository } from "./scanner.mjs";

async function runSync(input = ".", { beforeAtomicWrite, afterTemporaryWrite } = {}) {
  const root = await resolveRoot(input);
  await ensureManagedDirectory(root, "AI_CONTEXT");
  const contextPath = managedPath(root, GENERATED_FILE);
  const before = await readManagedTextSnapshot(root, contextPath);
  const facts = await scanRepository(root);
  await ensureManagedDirectory(root, "AI_CONTEXT");
  const current = await readManagedTextSnapshot(root, contextPath);
  if (!current.bytes.equals(before.bytes)) {
    throw new Error("CONTEXT.md cambió durante la sincronización; vuelve a intentarlo.");
  }
  if (!sameFilesystemIdentity(current.fileIdentity, before.fileIdentity)) {
    throw new Error("CONTEXT.md cambió de identidad durante la sincronización; vuelve a intentarlo.");
  }
  if (!sameFilesystemIdentity(current.parentIdentity, before.parentIdentity)) {
    throw new Error("El directorio administrado cambió durante la sincronización; vuelve a intentarlo.");
  }
  const after = replaceGeneratedBlock(current.text, facts);
  const changed = after !== before.text;
  if (changed && beforeAtomicWrite) await beforeAtomicWrite();
  if (changed) {
    await writeFileAtomic(root, contextPath, after, {
      expectedBytes: current.bytes,
      expectedFileIdentity: current.fileIdentity,
      expectedParentIdentity: current.parentIdentity,
      afterTemporaryWrite
    });
  }
  return { root, changed, facts };
}

export function syncRepository(input = ".") {
  return runSync(input);
}

export const __testing = Object.freeze({
  syncWithCheckpoint(input, checkpoint) {
    const checkpoints = typeof checkpoint === "function"
      ? { beforeAtomicWrite: checkpoint }
      : checkpoint;
    return runSync(input, checkpoints);
  }
});
