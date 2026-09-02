import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { END_MARKER, REQUIRED_FILES, START_MARKER } from "../src/contract.mjs";
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
  assert.match(
    context,
    /Huella del inventario basada en ruta:tamaño \(no es hash de contenido\): `sha256:[a-f0-9]{64}`/u
  );
});

test("init preserva byte por byte un TASKS.md existente", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  const tasksPath = path.join(root, "AI_CONTEXT", "TASKS.md");
  const existing = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("# Tarea existente\r\n\r\nPreservar trailing spaces  \r\nÚltima línea")
  ]);
  await writeFile(tasksPath, existing);

  const result = await initRepository(root);

  assert.deepEqual(result.created, []);
  assert.ok(result.preserved.includes("AI_CONTEXT/TASKS.md"));
  assert.deepEqual(await readFile(tasksPath), existing);
});

test("init preserva byte por byte un DECISIONS.md existente", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  const decisionsPath = path.join(root, "AI_CONTEXT", "DECISIONS.md");
  const existing = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("# Decisión existente\r\n\r\nNo migrar ni reescribir  \r\nÚltima línea")
  ]);
  await writeFile(decisionsPath, existing);

  const result = await initRepository(root);

  assert.deepEqual(result.created, []);
  assert.ok(result.preserved.includes("AI_CONTEXT/DECISIONS.md"));
  assert.deepEqual(await readFile(decisionsPath), existing);
});

test("init preserva como bytes el contenido repository-owned de CONTEXT.md", async (t) => {
  const root = await temporaryRepository(t);
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  await mkdir(path.dirname(contextPath), { recursive: true });
  const prefix = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("---\r\nproject_brain: 1\r\nrole: context\r\n---\r\n# caf\u00e9 y cafe\u0301 \u{1f9e0}\t  \r\n")
  ]);
  const suffix = Buffer.from("\r\nContenido \u{1f680}\tcon trailing spaces  \r\nÚltima línea sin newline");
  await writeFile(contextPath, Buffer.concat([
    prefix,
    Buffer.from(`${START_MARKER}\r\nproyección obsoleta\r\n${END_MARKER}`),
    suffix
  ]));

  const result = await initRepository(root);
  const after = await readFile(contextPath);
  const start = after.indexOf(Buffer.from(START_MARKER));
  const end = after.indexOf(Buffer.from(END_MARKER), start) + Buffer.byteLength(END_MARKER);

  assert.ok(result.preserved.includes("AI_CONTEXT/CONTEXT.md"));
  assert.deepEqual(after.subarray(0, start), prefix);
  assert.deepEqual(after.subarray(end), suffix);
  assert.notEqual(after.at(-1), 0x0a);
});

test("init rechaza CONTEXT.md con UTF-8 inválido antes de crear artefactos", async (t) => {
  const root = await temporaryRepository(t);
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  await mkdir(path.dirname(contextPath), { recursive: true });
  const invalid = Buffer.concat([
    Buffer.from(`# Contexto\n${START_MARKER}\n`),
    Buffer.from([0x80]),
    Buffer.from(`\n${END_MARKER}\nContenido repository-owned\n`)
  ]);
  await writeFile(contextPath, invalid);

  await assert.rejects(
    () => initRepository(root),
    (error) => error?.code === "INVALID_UTF8" && /UTF-8 válido/u.test(error.message)
  );

  assert.deepEqual(await readFile(contextPath), invalid);
  assert.deepEqual(await readdir(root), ["AI_CONTEXT"]);
  assert.deepEqual(await readdir(path.join(root, "AI_CONTEXT")), ["CONTEXT.md"]);
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
