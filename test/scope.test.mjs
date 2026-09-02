import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as publicApi from "@ruzer/project-brain";
import { put, temporaryRepository } from "../test-support/helpers.mjs";

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

test("el paquete conserva Node 20+, cero dependencias y un único binario", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert.deepEqual(packageJson.bin, { brain: "./bin/brain.mjs" });
  assert.deepEqual(await readdir(path.join(root, "bin")), ["brain.mjs"]);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.deepEqual(packageJson.engines, { node: ">=20" });
  assert.equal(packageJson.main, "./src/index.mjs");
  assert.deepEqual(packageJson.exports, {
    ".": "./src/index.mjs",
    "./schema": "./schema/context-contract.schema.json"
  });
});

test("las capacidades históricas permanecen fuera del producto Lite", async () => {
  const forbiddenRoots = [
    "agents",
    "analysis",
    "config",
    "core",
    "database",
    "databases",
    "governance",
    "integrations",
    "memory",
    "models",
    "operations",
    "orchestrator",
    "patches",
    "planning",
    "plugins",
    "prompts",
    "reports",
    "swarm"
  ];
  const files = await projectFiles();
  for (const directory of forbiddenRoots) {
    assert.equal(
      files.some((file) => file === directory || file.startsWith(`${directory}/`)),
      false,
      `el runtime retirado reapareció: ${directory}/`
    );
  }
});

test("la API pública conserva exactamente los siete exports de 0.3.x", () => {
  assert.deepEqual(Object.keys(publicApi).sort(), [
    "CONTRACT",
    "CONTRACT_SCHEMA",
    "doctor",
    "doctorRepository",
    "initRepository",
    "scanRepository",
    "syncRepository"
  ]);
  for (const name of [
    "doctor",
    "doctorRepository",
    "initRepository",
    "scanRepository",
    "syncRepository"
  ]) {
    assert.equal(typeof publicApi[name], "function", `export público inválido: ${name}`);
  }
  assert.equal(publicApi.doctorRepository, publicApi.doctor);
});

test("el contrato conserva los cinco archivos, marcadores y límites canónicos", () => {
  const expected = {
    contractVersion: 1,
    files: [
      "AGENTS.md",
      "AI_CONTEXT/CONTEXT.md",
      "AI_CONTEXT/DECISIONS.md",
      "AI_CONTEXT/TASKS.md",
      "AI_CONTEXT/LEARNINGS.md"
    ],
    generatedFile: "AI_CONTEXT/CONTEXT.md",
    markers: {
      start: "<!-- brain:generated:start -->",
      end: "<!-- brain:generated:end -->"
    },
    limits: {
      bytesPerFile: 12288,
      linesPerFile: 240,
      totalBytes: 40960
    }
  };

  assert.deepEqual(publicApi.CONTRACT, expected);
  assert.deepEqual(publicApi.CONTRACT_SCHEMA.default, expected);
});

test("scanner y doctor no incorporan clientes de red", async () => {
  const runtimeFiles = (await projectFiles()).filter(
    (file) => /^(?:src|bin)\/.*\.mjs$/u.test(file)
  );
  const forbiddenImport = /(?:from\s+|import\s*\()["']node:(?:dgram|dns|http|http2|https|net|tls)["']/u;

  for (const file of runtimeFiles) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.doesNotMatch(source, forbiddenImport, `cliente de red incorporado en ${file}`);
    assert.doesNotMatch(source, /\bfetch\s*\(/u, `fetch incorporado en ${file}`);
    assert.doesNotMatch(source, /\bWebSocket\b/u, `WebSocket incorporado en ${file}`);
  }
});

test("scanner y doctor sólo detectan comandos candidatos: nunca los ejecutan", async (t) => {
  const repository = await temporaryRepository(t);
  const sentinel = path.join(repository, "executed-by-project-brain");
  await publicApi.initRepository(repository);
  const packageContent = `${JSON.stringify({
    scripts: {
      test: "node -e \"require('node:fs').writeFileSync('executed-by-project-brain','')\""
    }
  }, null, 2)}\n`;
  const packagePath = await put(repository, "package.json", packageContent);

  const observation = await publicApi.scanRepository(repository);
  const diagnosis = await publicApi.doctor(repository);

  assert.deepEqual(observation.validationCommands, ["npm run test"]);
  assert.equal(diagnosis.ok, true);
  assert.ok(diagnosis.warnings.some((warning) =>
    warning.checkId === "generated-freshness" &&
    warning.code === "STALE_GENERATED_PROJECTION"
  ));
  assert.equal(await readFile(packagePath, "utf8"), packageContent);
  await assert.rejects(access(sentinel), { code: "ENOENT" });
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
