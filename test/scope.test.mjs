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

test("la documentación de TechnicalSource no introduce fetching", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const section = readme.match(
    /^### Alcance de TechnicalSource\s*$([\s\S]*?)(?=^### |^## )/mu
  )?.[1];

  assert.ok(section, "falta la sección de TechnicalSource");
  assert.match(
    section,
    /referencia externa[^\n]*IntegrationReference[^\n]*no transfiere autoridad[^\n]*no provoca acceso de red/iu
  );
  assert.doesNotMatch(section, /\]\(https?:\/\//iu);
  assert.doesNotMatch(section, /\b(?:curl|wget)\b|\bfetch\s*\(/iu);
});

test("IntegrationReference no amplía el runtime ni el contrato canónico", async () => {
  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const section = readme.match(
    /^### Convención de IntegrationReference\s*$([\s\S]*?)(?=^### |^## )/mu
  )?.[1];

  assert.ok(section, "falta la convención de IntegrationReference");
  assert.match(section, /no (?:implementa|introduce)[^\n]*conectores[^\n]*fetching[^\n]*sincronización/iu);
  assert.match(section, /no crea[^\n]*sexto artefacto canónico/iu);
  assert.match(section, /destinos remotos[^\n]*nunca[^\n]*(?:consultados|accedidos) automáticamente/iu);
  assert.doesNotMatch(section, /\bbrain\s+(?:connect|integrate|pull|push)\b/iu);
  assert.doesNotMatch(section, /schema obligatorio/iu);
});
