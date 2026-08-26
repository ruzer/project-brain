import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignored = new Set([".git", "node_modules", "coverage", "dist", "build"]);

async function projectFiles(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await projectFiles(target)));
    else if (entry.isFile()) files.push(path.relative(root, target));
  }
  return files.sort();
}

test("el producto completo permanece debajo de 50 archivos", async () => {
  const files = await projectFiles();
  assert.ok(files.length < 50, `el repositorio volvió a crecer a ${files.length} archivos`);
});

test("el paquete no instala runtimes ni publica otros comandos", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(packageJson.bin), ["brain"]);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.equal(packageJson.main, "./src/index.mjs");
  assert.equal(packageJson.exports["."], "./src/index.mjs");

  const forbiddenRoots = ["agents", "analysis", "core", "governance", "memory", "orchestrator", "patches", "reports"];
  const files = await projectFiles();
  for (const directory of forbiddenRoots) {
    assert.equal(
      files.some((file) => file === directory || file.startsWith(`${directory}/`)),
      false,
      `el runtime retirado reapareció: ${directory}/`
    );
  }
});

test("la API pública expone operaciones estables sin añadir comandos", async () => {
  const api = await import("../src/index.mjs");
  for (const name of ["doctor", "initRepository", "scanRepository", "syncRepository"]) {
    assert.equal(typeof api[name], "function", `falta export público: ${name}`);
  }
});
