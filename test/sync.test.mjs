import assert from "node:assert/strict";
import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { END_MARKER } from "../src/contract.mjs";
import { initRepository } from "../src/init.mjs";
import { syncRepository } from "../src/sync.mjs";
import { get, put, temporaryRepository } from "../test-support/helpers.mjs";

test("sync cambia solo el bloque generado, preserva lo manual y es idempotente", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "package.json", JSON.stringify({
    scripts: { check: "node --check src/index.js", test: "node --test" },
    dependencies: { react: "latest" }
  }, null, 2));
  await put(root, "src/index.js", "export const answer = 42;\n");
  await initRepository(root);

  const original = await get(root, "AI_CONTEXT/CONTEXT.md");
  const withManual = original.replace(END_MARKER, `${END_MARKER}\n\nNota manual indeleble.`);
  await put(root, "AI_CONTEXT/CONTEXT.md", withManual);
  await put(root, "src/extra.js", "export const extra = true;\n");

  const first = await syncRepository(root);
  const after = await get(root, "AI_CONTEXT/CONTEXT.md");
  assert.equal(first.changed, true);
  assert.match(after, /Nota manual indeleble\./);
  assert.match(after, /Node\.js/);
  assert.match(after, /React/);
  assert.match(after, /`npm run check`/);

  const second = await syncRepository(root);
  assert.equal(second.changed, false);
  assert.equal(await get(root, "AI_CONTEXT/CONTEXT.md"), after);
});
test("sync falla de forma segura si faltan marcadores", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  const invalid = "# Contexto\n\nContenido manual sin bloque.\n";
  await put(root, "AI_CONTEXT/CONTEXT.md", invalid);

  await assert.rejects(() => syncRepository(root), /exactamente un bloque/);
  assert.equal(await get(root, "AI_CONTEXT/CONTEXT.md"), invalid);
});

test("sync preserva los permisos del archivo de contexto", async (t) => {
  if (process.platform === "win32") {
    t.skip("los permisos POSIX no aplican en Windows");
    return;
  }

  const root = await temporaryRepository(t);
  await initRepository(root);
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  await chmod(contextPath, 0o600);
  await put(root, "nuevo.js", "export default true;\n");

  await syncRepository(root);
  assert.equal((await stat(contextPath)).mode & 0o777, 0o600);
});
