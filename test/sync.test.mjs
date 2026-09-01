import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { END_MARKER, GENERATED_FILE, REQUIRED_FILES, START_MARKER } from "../src/contract.mjs";
import { initRepository, syncRepository } from "../src/index.mjs";
import { __testing as syncTesting } from "../src/sync.mjs";
import { get, put, temporaryRepository } from "../test-support/helpers.mjs";

const execFileAsync = promisify(execFile);
const brainBin = fileURLToPath(new URL("../bin/brain.mjs", import.meta.url));
const startMarkerBytes = Buffer.from(START_MARKER);
const endMarkerBytes = Buffer.from(END_MARKER);
const combinedPreservationCase = {
  name: "combinación representativa",
  prefix: Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("---\r\nproject_brain: 1\r\nrole: context\r\n---\r\n# caf\u00e9 y cafe\u0301 \u{1f9e0}\t  \r\n")
  ]),
  suffix: Buffer.from("\r\nContenido \u{1f680}\tcon trailing spaces  \r\nÚltima línea sin newline"),
  lineEnding: "\r\n",
  noFinalNewline: true
};

const preservationCases = [
  {
    name: "CRLF",
    prefix: Buffer.from("# Contexto\r\n\r\n"),
    suffix: Buffer.from("\r\n\r\nContenido del repositorio\r\n"),
    lineEnding: "\r\n"
  },
  {
    name: "BOM UTF-8",
    prefix: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("# Contexto\n")]),
    suffix: Buffer.from("\nContenido del repositorio\n")
  },
  {
    name: "Unicode",
    prefix: Buffer.from("# Español, 漢字 y العربية\n"),
    suffix: Buffer.from("\nΕλληνικά y português\n")
  },
  {
    name: "Unicode NFC y NFD",
    prefix: Buffer.from("# caf\u00e9\n"),
    suffix: Buffer.from("\ncafe\u0301\n")
  },
  {
    name: "emoji",
    prefix: Buffer.from("# Contexto \u{1f9e0}\n"),
    suffix: Buffer.from("\nContenido \u{1f680}\n")
  },
  {
    name: "tabs",
    prefix: Buffer.from("#\tContexto\n"),
    suffix: Buffer.from("\n\tContenido\t\n")
  },
  {
    name: "trailing spaces",
    prefix: Buffer.from("# Contexto  \nLínea con tab\t \n"),
    suffix: Buffer.from("\nContenido con espacios   \n")
  },
  {
    name: "ausencia de newline final",
    prefix: Buffer.from("# Contexto\n"),
    suffix: Buffer.from("\nContenido sin newline final"),
    noFinalNewline: true
  },
  combinedPreservationCase
];

const invalidUtf8Cases = [
  { name: "antes del bloque generado", placement: "before", bytes: Buffer.from([0x80]) },
  { name: "dentro del bloque generado", placement: "inside", bytes: Buffer.from([0xc0, 0xaf]) },
  { name: "después del bloque generado", placement: "after", bytes: Buffer.from([0xe2, 0x82]) }
];

function contextFixture({ prefix, suffix, lineEnding = "\n" }) {
  return Buffer.concat([
    prefix,
    startMarkerBytes,
    Buffer.from(`${lineEnding}proyección obsoleta${lineEnding}`),
    endMarkerBytes,
    suffix
  ]);
}

function contextSegments(content) {
  const start = content.indexOf(startMarkerBytes);
  const endStart = content.indexOf(endMarkerBytes, start);
  assert.notEqual(start, -1, "falta el marcador inicial");
  assert.notEqual(endStart, -1, "falta el marcador final");
  const end = endStart + endMarkerBytes.length;
  return {
    prefix: content.subarray(0, start),
    projection: content.subarray(start, end),
    suffix: content.subarray(end)
  };
}

async function writeContextFixture(root, fixture) {
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  const before = contextFixture(fixture);
  await writeFile(contextPath, before);
  return { before, contextPath };
}

function insertInvalidUtf8(content, { placement, bytes }) {
  const start = content.indexOf(startMarkerBytes);
  const end = content.indexOf(endMarkerBytes, start);
  assert.notEqual(start, -1, "falta el marcador inicial");
  assert.notEqual(end, -1, "falta el marcador final");
  const offset = placement === "before"
    ? start
    : placement === "inside"
      ? start + startMarkerBytes.length
      : end + endMarkerBytes.length;
  return Buffer.concat([content.subarray(0, offset), bytes, content.subarray(offset)]);
}

async function canonicalBuffers(root) {
  return Object.fromEntries(await Promise.all(REQUIRED_FILES.map(async (relative) => [
    relative,
    await readFile(path.join(root, relative))
  ])));
}

async function repositoryTree(root) {
  return {
    root: (await readdir(root)).sort(),
    context: (await readdir(path.join(root, "AI_CONTEXT"))).sort()
  };
}

async function repositoryState(root) {
  return {
    files: await canonicalBuffers(root),
    tree: await repositoryTree(root)
  };
}

async function assertRepositoryUnchanged(root, before) {
  const after = await repositoryState(root);
  assert.deepEqual(after, before);
  assert.equal(
    [...after.tree.root, ...after.tree.context].some((name) => name.endsWith(".tmp")),
    false
  );
}

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

test("sync preserva byte por byte RepositoryOwnedContent UTF-8 válido", async (t) => {
  for (const fixture of preservationCases) {
    await t.test(fixture.name, async (t) => {
      const root = await temporaryRepository(t);
      await initRepository(root);
      const { before, contextPath } = await writeContextFixture(root, fixture);
      const beforeSegments = contextSegments(before);

      const first = await syncRepository(root);
      const after = await readFile(contextPath);
      const afterSegments = contextSegments(after);

      assert.equal(first.changed, true);
      assert.deepEqual(afterSegments.prefix, beforeSegments.prefix);
      assert.deepEqual(afterSegments.suffix, beforeSegments.suffix);
      assert.notDeepEqual(afterSegments.projection, beforeSegments.projection);
      if (fixture.noFinalNewline) assert.notEqual(after.at(-1), 0x0a);

      const second = await syncRepository(root);
      assert.equal(second.changed, false);
      assert.deepEqual(await readFile(contextPath), after);
    });
  }
});

test("brain sync preserva bytes repository-owned e idempotencia desde la CLI real", async (t) => {
  const root = await temporaryRepository(t, "brain cli bytes ");
  await initRepository(root);
  const { before, contextPath } = await writeContextFixture(root, combinedPreservationCase);
  const beforeSegments = contextSegments(before);

  const first = await execFileAsync(process.execPath, [brainBin, "sync", root, "--json"], { encoding: "utf8" });
  assert.equal(first.stderr, "");
  assert.equal(JSON.parse(first.stdout).changed, true);
  const after = await readFile(contextPath);
  const afterSegments = contextSegments(after);
  assert.deepEqual(afterSegments.prefix, beforeSegments.prefix);
  assert.deepEqual(afterSegments.suffix, beforeSegments.suffix);

  const second = await execFileAsync(process.execPath, [brainBin, "sync", root, "--json"], { encoding: "utf8" });
  assert.equal(second.stderr, "");
  assert.equal(JSON.parse(second.stdout).changed, false);
  assert.deepEqual(await readFile(contextPath), after);
});

test("sync rechaza UTF-8 inválido sin modificar ningún artefacto", async (t) => {
  for (const fixture of invalidUtf8Cases) {
    await t.test(fixture.name, async (t) => {
      const root = await temporaryRepository(t);
      await initRepository(root);
      await put(root, "nuevo.js", "export default true;\n");
      const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
      const invalid = insertInvalidUtf8(await readFile(contextPath), fixture);
      await writeFile(contextPath, invalid);
      const before = await repositoryState(root);

      await assert.rejects(
        () => syncRepository(root),
        (error) => error?.code === "INVALID_UTF8" && /UTF-8 válido/u.test(error.message)
      );

      await assertRepositoryUnchanged(root, before);
    });
  }
});

test("brain sync --json rechaza UTF-8 inválido sin escribir", async (t) => {
  const root = await temporaryRepository(t, "brain cli utf8 inválido ");
  await initRepository(root);
  await put(root, "nuevo.js", "export default true;\n");
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  await writeFile(
    contextPath,
    insertInvalidUtf8(await readFile(contextPath), invalidUtf8Cases[1])
  );
  const before = await repositoryState(root);

  const failure = await execFileAsync(
    process.execPath,
    [brainBin, "sync", root, "--json"],
    { encoding: "utf8" }
  ).then(() => null, (error) => error);

  assert.equal(failure?.code, 1);
  assert.equal(failure.stderr, "");
  const payload = JSON.parse(failure.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "COMMAND_FAILED");
  assert.match(payload.error.message, /UTF-8 válido/u);
  await assertRepositoryUnchanged(root, before);
});

test("sync aborta si CONTEXT.md cambia después de la segunda lectura", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  await put(root, "nuevo.js", "export default true;\n");
  const contextPath = path.join(root, GENERATED_FILE);
  const competitor = Buffer.concat([
    await readFile(contextPath),
    Buffer.from("\nEdición competidora repository-owned completa.\n")
  ]);
  const before = await repositoryState(root);
  let checkpointCalls = 0;

  await assert.rejects(
    () => syncTesting.syncWithCheckpoint(root, async () => {
      checkpointCalls += 1;
      await writeFile(contextPath, competitor);
    }),
    /CONTEXT\.md cambió durante la sincronización/u
  );

  const after = await repositoryState(root);
  assert.equal(checkpointCalls, 1);
  assert.deepEqual(after.files[GENERATED_FILE], competitor);
  for (const relative of REQUIRED_FILES.filter((file) => file !== GENERATED_FILE)) {
    assert.deepEqual(after.files[relative], before.files[relative]);
  }
  assert.deepEqual(after.tree, before.tree);
  assert.equal(
    [...after.tree.root, ...after.tree.context].some((name) => name.endsWith(".tmp")),
    false
  );
});

test("sync falla de forma segura si faltan marcadores", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  const invalid = "# Contexto\n\nContenido manual sin bloque.\n";
  await put(root, "AI_CONTEXT/CONTEXT.md", invalid);

  await assert.rejects(() => syncRepository(root), /exactamente un bloque/);
  assert.equal(await get(root, "AI_CONTEXT/CONTEXT.md"), invalid);
});

test("sync preserva el modo POSIX completo aunque el umask restrinja el archivo temporal", async (t) => {
  if (process.platform === "win32") {
    t.skip("los permisos POSIX no aplican en Windows");
    return;
  }

  const root = await temporaryRepository(t);
  await initRepository(root);
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  await chmod(contextPath, 0o1750);
  const expectedMode = (await stat(contextPath)).mode & 0o7777;
  assert.equal(expectedMode, 0o1750);
  await put(root, "nuevo.js", "export default true;\n");

  const previousUmask = process.umask(0o077);
  try {
    await syncRepository(root);
    assert.equal((await stat(contextPath)).mode & 0o7777, expectedMode);
  } finally {
    process.umask(previousUmask);
  }
});
