import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { get, put, temporaryRepository } from "../test-support/helpers.mjs";

const brainBin = fileURLToPath(new URL("../bin/brain.mjs", import.meta.url));
const packageUrl = new URL("../package.json", import.meta.url);
const canonicalFiles = [
  "AGENTS.md",
  "AI_CONTEXT/CONTEXT.md",
  "AI_CONTEXT/DECISIONS.md",
  "AI_CONTEXT/TASKS.md",
  "AI_CONTEXT/LEARNINGS.md"
];

function runBrain(args) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [brainBin, ...args],
      {
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number" && !error.killed && !error.signal) {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }
        reject(error);
      }
    );
  });
}

function parseCleanJson(result, expectedExitCode = 0) {
  assert.equal(result.exitCode, expectedExitCode);
  assert.equal(result.stderr, "");
  assert.notEqual(result.stdout.trim(), "");
  return JSON.parse(result.stdout);
}

test("brain real publica únicamente help y version de Lite", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const help = await runBrain(["--help"]);
  const version = await runBrain(["--version"]);

  assert.equal(help.exitCode, 0);
  assert.equal(help.stderr, "");
  assert.deepEqual(
    [...help.stdout.matchAll(/^  brain (\w+)/gmu)].map((match) => match[1]),
    ["init", "sync", "doctor"]
  );
  assert.equal(version.exitCode, 0);
  assert.equal(version.stderr, "");
  assert.equal(version.stdout, `${packageJson.version}\n`);
});

test("brain real completa init, sync y doctor JSON en una ruta con espacios y Unicode", async (t) => {
  const parent = await temporaryRepository(t, "brain-process-");
  const root = path.join(parent, "Proyecto con espacios á 🚀");

  const initialized = parseCleanJson(await runBrain(["init", root, "--json"]));
  assert.deepEqual([...initialized.created].sort(), [...canonicalFiles].sort());
  assert.deepEqual(initialized.preserved, []);
  assert.equal(initialized.root, await realpath(root));

  await put(root, "src/código.js", "export const listo = '✅';\n");
  const firstSync = parseCleanJson(await runBrain(["sync", root, "--json"]));
  const secondSync = parseCleanJson(await runBrain(["sync", root, "--json"]));
  assert.equal(firstSync.changed, true);
  assert.equal(secondSync.changed, false);

  const diagnosis = parseCleanJson(await runBrain(["doctor", root, "--json"]));
  assert.equal(diagnosis.ok, true);
  assert.deepEqual(diagnosis.errors, []);
  assert.deepEqual(diagnosis.warnings, []);
});

test("brain doctor real conserva warning-only de role en stderr con exit cero", async (t) => {
  const root = await temporaryRepository(t, "brain-process-role-");
  parseCleanJson(await runBrain(["init", root, "--json"]));
  const tasks = await get(root, "AI_CONTEXT/TASKS.md");
  assert.match(tasks, /^role: tasks$/mu);
  await put(root, "AI_CONTEXT/TASKS.md", tasks.replace(/^role: tasks$/mu, "role: wrong"));

  const result = await runBrain(["doctor", root]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /AVISO UNKNOWN_ARTIFACT_ROLE:/u);
  assert.match(result.stdout, /Contexto sano \([1-9]\d* comprobaciones\)\./u);
});

test("brain doctor real serializa freshness warning-only como JSON limpio", async (t) => {
  const root = await temporaryRepository(t, "brain-process-fresh-");
  parseCleanJson(await runBrain(["init", root, "--json"]));
  await put(root, "src/nuevo.js", "export default true;\n");

  const result = await runBrain(["doctor", root, "--json"]);
  const diagnosis = parseCleanJson(result);

  assert.equal(diagnosis.ok, true);
  assert.deepEqual(diagnosis.errors, []);
  assert.ok(diagnosis.warnings.some((warning) =>
    warning.checkId === "generated-freshness" &&
    warning.code === "STALE_GENERATED_PROJECTION" &&
    warning.severity === "warning"
  ));
});

test("brain doctor real separa errores en stderr y termina con exit uno", async (t) => {
  const root = await temporaryRepository(t, "brain-process-error-");
  parseCleanJson(await runBrain(["init", root, "--json"]));
  await unlink(path.join(root, "AI_CONTEXT", "TASKS.md"));

  const result = await runBrain(["doctor", root]);

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /ERROR MISSING_CANONICAL_FILE:/u);
  assert.match(result.stdout, /Contexto inválido \([1-9]\d* errores\)\./u);
});

test("brain real rechaza opción desconocida y ruta inexistente por sus canales públicos", async (t) => {
  const root = await temporaryRepository(t, "brain-process-invalid-");
  const unknown = await runBrain(["doctor", root, "--force"]);

  assert.equal(unknown.exitCode, 1);
  assert.equal(unknown.stdout, "");
  assert.match(unknown.stderr, /Opción desconocida: --force/u);

  const missing = path.join(root, "no existe");
  const failed = await runBrain(["sync", missing, "--json"]);
  const payload = parseCleanJson(failed, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "COMMAND_FAILED");
  assert.match(payload.error.message, /ENOENT/u);
});
