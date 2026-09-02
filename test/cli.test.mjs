import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.mjs";
import { initRepository } from "../src/index.mjs";
import { put, temporaryRepository } from "../test-support/helpers.mjs";

function capture() {
  const output = { logs: [], errors: [], warnings: [] };
  return {
    output,
    io: {
      log: (value) => output.logs.push(String(value)),
      error: (value) => output.errors.push(String(value)),
      warn: (value) => output.warnings.push(String(value))
    }
  };
}

test("la ayuda publica únicamente init, sync y doctor", async () => {
  const { output, io } = capture();
  assert.equal(await runCli(["--help"], io), 0);
  const help = output.logs.join("\n");
  assert.deepEqual(
    [...help.matchAll(/^  brain (\w+)/gm)].map((match) => match[1]),
    ["init", "sync", "doctor"]
  );
});

test("un comando desconocido devuelve error accionable", async () => {
  const { output, io } = capture();
  assert.equal(await runCli(["swarm"], io), 1);
  assert.match(output.errors.join("\n"), /Comando desconocido: swarm/);
});

test("una opción desconocida no se interpreta como ruta de escritura", async () => {
  const { output, io } = capture();
  assert.equal(await runCli(["init", "--force"], io), 1);
  assert.match(output.errors.join("\n"), /Opción desconocida: --force/);
});

test("--json conserva salida estructurada incluso ante una excepción", async () => {
  const { output, io } = capture();
  assert.equal(await runCli(["sync", "/ruta/que/no/existe", "--json"], io), 1);
  assert.deepEqual(output.errors, []);
  const payload = JSON.parse(output.logs.join("\n"));
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "COMMAND_FAILED");
});

test("doctor CLI conserva exit codes y serializa metadatos de Diagnostic", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  await put(root, "AI_CONTEXT/EXTRA.md", "# Extra\n");
  const warningRun = capture();

  assert.equal(await runCli(["doctor", root, "--json"], warningRun.io), 0);
  const warningResult = JSON.parse(warningRun.output.logs.join("\n"));
  assert.equal(warningResult.ok, true);
  assert.ok(warningResult.warnings.every((diagnostic) =>
    diagnostic.severity === "warning" && typeof diagnostic.checkId === "string"
  ));

  await unlink(path.join(root, "AI_CONTEXT", "TASKS.md"));
  const errorRun = capture();
  assert.equal(await runCli(["doctor", root, "--json"], errorRun.io), 1);
  const errorResult = JSON.parse(errorRun.output.logs.join("\n"));
  assert.equal(errorResult.ok, false);
  assert.ok(errorResult.errors.every((diagnostic) =>
    diagnostic.severity === "error" && typeof diagnostic.checkId === "string"
  ));
});

test("doctor CLI reporta proyección desactualizada como warning exitoso", async (t) => {
  const root = await temporaryRepository(t);
  await initRepository(root);
  await put(root, "nuevo.js", "export default true;\n");
  const run = capture();

  assert.equal(await runCli(["doctor", root, "--json"], run.io), 0);
  const result = JSON.parse(run.output.logs.join("\n"));
  const stale = result.warnings.find((diagnostic) =>
    diagnostic.code === "STALE_GENERATED_PROJECTION"
  );
  assert.equal(result.ok, true);
  assert.equal(stale?.checkId, "generated-freshness");
  assert.equal(stale?.severity, "warning");
});
