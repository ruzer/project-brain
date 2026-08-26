import { GENERATED_FILE } from "./contract.mjs";
import { replaceGeneratedBlock } from "./context.mjs";
import { ensureManagedDirectory, managedPath, readText, resolveRoot, writeFileAtomic } from "./fs.mjs";
import { scanRepository } from "./scanner.mjs";

export async function syncRepository(input = ".") {
  const root = await resolveRoot(input);
  await ensureManagedDirectory(root, "AI_CONTEXT");
  const contextPath = managedPath(root, GENERATED_FILE);
  const before = await readText(contextPath);
  const facts = await scanRepository(root);
  await ensureManagedDirectory(root, "AI_CONTEXT");
  const current = await readText(contextPath);
  if (current !== before) throw new Error("CONTEXT.md cambió durante la sincronización; vuelve a intentarlo.");
  const after = replaceGeneratedBlock(current, facts);
  const changed = after !== before;
  if (changed) await writeFileAtomic(root, contextPath, after);
  return { root, changed, facts };
}
