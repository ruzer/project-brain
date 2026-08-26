import assert from "node:assert/strict";
import { chmod, mkdir, readdir, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { REQUIRED_FILES } from "../src/contract.mjs";
import { initRepository } from "../src/init.mjs";
import { get, put, temporaryRepository } from "../test-support/helpers.mjs";

test("init crea exactamente el contrato mínimo y sincroniza hechos", async (t) => {
  const parent = await temporaryRepository(t);
  const root = path.join(parent, "nuevo");
  const result = await initRepository(root);

  assert.deepEqual(result.created, REQUIRED_FILES);
  const rootEntries = (await readdir(root)).sort();
  assert.deepEqual(rootEntries, ["AGENTS.md", "AI_CONTEXT"]);
  assert.deepEqual((await readdir(path.join(root, "AI_CONTEXT"))).sort(), [
    "CONTEXT.md", "DECISIONS.md", "LEARNINGS.md", "TASKS.md"
  ]);
  const context = await get(root, "AI_CONTEXT/CONTEXT.md");
  assert.match(context, /Huella del inventario: `sha256:[a-f0-9]{64}`/);
});

test("init nunca sobrescribe contenido manual existente", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  const manual = "# Tareas\n\n- [ ] Mantener esta línea exactamente.\n";
  await put(root, "AI_CONTEXT/TASKS.md", manual);

  const result = await initRepository(root);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.preserved, REQUIRED_FILES);
  assert.equal(await get(root, "AI_CONTEXT/TASKS.md"), manual);
});

test("init rechaza enlaces simbólicos canónicos antes de escribir", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "destino.md", "no tocar\n");
  await symlink(path.join(root, "destino.md"), path.join(root, "AGENTS.md"));

  await assert.rejects(() => initRepository(root), /enlaces simbólicos/);
  await assert.rejects(() => readdir(path.join(root, "AI_CONTEXT")), /ENOENT/);
});

test("init rechaza AI_CONTEXT simbólico sin escribir fuera del contrato", async (t) => {
  const root = await temporaryRepository(t);
  await mkdir(path.join(root, "destino"));
  await symlink("destino", path.join(root, "AI_CONTEXT"));

  await assert.rejects(() => initRepository(root), /directorios simbólicos/);
  await assert.rejects(() => get(root, "AGENTS.md"), /ENOENT/);
  assert.deepEqual(await readdir(path.join(root, "destino")), []);
});

test("init valida marcadores existentes antes de crear archivos faltantes", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "AI_CONTEXT/CONTEXT.md", "# Contexto inválido\n");

  await assert.rejects(() => initRepository(root), /exactamente un bloque/);
  assert.deepEqual(await readdir(root), ["AI_CONTEXT"]);
  assert.deepEqual(await readdir(path.join(root, "AI_CONTEXT")), ["CONTEXT.md"]);
});

test("init comprueba que el repositorio sea legible antes de publicar archivos", async (t) => {
  if (process.platform === "win32") {
    t.skip("los permisos POSIX no aplican en Windows");
    return;
  }
  const root = await temporaryRepository(t);
  const blocked = path.join(root, "blocked");
  await mkdir(blocked);
  await put(root, "blocked/file.txt", "privado\n");
  await chmod(blocked, 0o000);
  try {
    await assert.rejects(() => initRepository(root), /EACCES|permission denied/i);
  } finally {
    await chmod(blocked, 0o700);
  }
  assert.deepEqual(await readdir(root), ["blocked"]);
});
