import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.mjs";

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
