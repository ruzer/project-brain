import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CONTRACT, REQUIRED_FILES } from "../src/contract.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const templatesRoot = path.join(projectRoot, "templates");
const DOMAIN_TERMS = [
  "Repository",
  "TechnicalContextBundle",
  "ContextArtifact",
  "GeneratedProjection",
  "RepositoryOwnedContent",
  "RepositoryObservation",
  "TechnicalSource",
  "ObservedFact",
  "Detection",
  "TechnicalDecision",
  "TechnicalTask",
  "TechnicalLearning",
  "ContextContract",
  "DoctorCheckResult",
  "Diagnostic",
  "IntegrationReference"
];

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/);
  assert.equal(lines[0], "---", "el frontmatter debe iniciar en la primera línea");
  const end = lines.indexOf("---", 1);
  assert.ok(end > 1, "el frontmatter debe cerrar con ---");

  const entries = Object.fromEntries(
    lines.slice(1, end).map((line) => {
      const separator = line.indexOf(":");
      assert.ok(separator > 0, `entrada YAML simple inválida: ${line}`);
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    })
  );

  return { entries, end };
}

function markdownTargets(content) {
  const prose = content.replace(/`[^`\r\n]*`/gu, "");
  return [...prose.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

test("las plantillas implementan exactamente el contrato mínimo", async () => {
  assert.deepEqual(await listFiles(templatesRoot), [...REQUIRED_FILES].sort());

  let totalBytes = 0;
  for (const relativePath of REQUIRED_FILES) {
    const filePath = path.join(templatesRoot, relativePath);
    const info = await stat(filePath);
    const content = await readFile(filePath, "utf8");
    const lineCount = content.split(/\r?\n/).length;

    assert.ok(info.size <= CONTRACT.limits.bytesPerFile, `${relativePath} excede el límite por archivo`);
    assert.ok(lineCount <= CONTRACT.limits.linesPerFile, `${relativePath} excede el límite de líneas`);
    totalBytes += info.size;
  }

  assert.ok(totalBytes <= CONTRACT.limits.totalBytes, "las plantillas exceden el límite total");
});

test("las notas usan frontmatter simple y roles únicos", async () => {
  const expectedRoles = new Map([
    ["AI_CONTEXT/CONTEXT.md", "context"],
    ["AI_CONTEXT/DECISIONS.md", "decisions"],
    ["AI_CONTEXT/TASKS.md", "tasks"],
    ["AI_CONTEXT/LEARNINGS.md", "learnings"]
  ]);

  for (const [relativePath, role] of expectedRoles) {
    const content = await readFile(path.join(templatesRoot, relativePath), "utf8");
    const { entries } = parseFrontmatter(content);
    assert.deepEqual(Object.keys(entries).sort(), ["project_brain", "role"]);
    assert.equal(entries.project_brain, "1");
    assert.equal(entries.role, role);
  }
});

test("la plantilla CONTEXT separa las tres clases de GeneratedProjection", async () => {
  const content = await readFile(path.join(templatesRoot, "AI_CONTEXT/CONTEXT.md"), "utf8");
  const headings = [
    "## Observaciones verificadas del repositorio",
    "## Detecciones heurísticas",
    "## Comandos candidatos de validación"
  ];
  const indexes = headings.map((heading) => content.indexOf(heading));

  assert.ok(indexes.every((index) => index >= 0));
  assert.deepEqual([...indexes].sort((left, right) => left - right), indexes);
  assert.doesNotMatch(content, /## Hechos verificados del repositorio/u);
  assert.match(content, /ruta:tamaño.*no es hash de contenido/u);
});

test("todos los enlaces Markdown internos existen y conectan el contexto", async () => {
  const contents = new Map(
    await Promise.all(
      REQUIRED_FILES.map(async (relativePath) => [
        relativePath,
        await readFile(path.join(templatesRoot, relativePath), "utf8")
      ])
    )
  );

  const graph = new Map(REQUIRED_FILES.map((relativePath) => [relativePath, []]));
  for (const [relativePath, content] of contents) {
    assert.doesNotMatch(content, /\[\[[^\]]+\]\]/, `${relativePath} no debe requerir wikilinks`);

    for (const target of markdownTargets(content)) {
      assert.doesNotMatch(target, /^[a-z][a-z0-9+.-]*:/i, `${relativePath} contiene un enlace externo`);
      const cleanTarget = decodeURIComponent(target.split("#", 1)[0]);
      const absoluteTarget = path.resolve(path.dirname(path.join(templatesRoot, relativePath)), cleanTarget);
      const templateRelativeTarget = path.relative(templatesRoot, absoluteTarget).split(path.sep).join("/");
      assert.ok(
        REQUIRED_FILES.includes(templateRelativeTarget),
        `${relativePath} enlaza fuera del contrato mínimo: ${target}`
      );
      assert.ok((await stat(absoluteTarget)).isFile(), `${relativePath} enlaza a un archivo inexistente: ${target}`);
      graph.get(relativePath).push(templateRelativeTarget);
    }
  }

  const visited = new Set();
  const queue = ["AGENTS.md"];
  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...graph.get(current));
  }

  assert.deepEqual([...visited].sort(), [...REQUIRED_FILES].sort());
});

test("README publica el glosario canónico, autoridades y no-equivalencias", async () => {
  const readme = await readFile(path.join(projectRoot, "README.md"), "utf8");

  for (const term of DOMAIN_TERMS) {
    assert.match(readme, new RegExp(`\\*\\*${term}\\*\\*:`, "u"), `falta ${term}`);
  }

  assert.match(readme, /Repository[^\n]*autoridad factual/iu);
  assert.match(readme, /TechnicalContextBundle[^\n]*cinco[^\n]*ContextArtifact/iu);
  assert.doesNotMatch(readme, /ownership derivado/iu);
  assert.match(readme, /Project Brain[^\n]*autoridad de escritura únicamente[^\n]*GeneratedProjection/iu);
  assert.match(readme, /RepositoryOwnedContent[^\n]*repositorio[^\n]*preserv/iu);
  assert.match(readme, /Memory Hub[^\n]*owners[^\n]*fechas[^\n]*riesgos[^\n]*milestones[^\n]*estado de gestión/iu);
  assert.match(readme, /Git[^\n]*historial/iu);

  for (const statement of [
    "fingerprint != content hash",
    "doctor OK != context fresh",
    "detected command != executed command"
  ]) {
    assert.match(readme, new RegExp(statement, "u"));
  }

  const currentProduct = readme.split("## Migración desde 0.2.x", 1)[0];
  assert.doesNotMatch(
    currentProduct,
    /\b(?:swarm|governance|orchestrator|LLM routing|runtime memory|patch proposals)\b/iu
  );
});

test("TechnicalDecision limita autoridad, reemplazo y campos de gestión", async () => {
  const readme = await readFile(path.join(projectRoot, "README.md"), "utf8");
  const decisions = await readFile(
    path.join(templatesRoot, "AI_CONTEXT", "DECISIONS.md"),
    "utf8"
  );

  assert.match(readme, /propuesta \(`proposed`\)[^\n]*no autoritativa/iu);
  assert.match(readme, /aceptada \(`accepted`\)[^\n]*único estado normativo/iu);
  assert.match(readme, /reemplazada \(`replaced`\)[^\n]*deja de ser normativa[^\n]*sucesora/iu);
  assert.match(readme, /Git[^\n]*historial detallado/iu);
  assert.match(readme, /estado técnico[^\n]*estado de gestión/iu);

  assert.match(decisions, /decisiones técnicas del repositorio/iu);
  assert.match(decisions, /\*\*Estado:\*\* propuesta \| aceptada \| reemplazada/u);
  assert.match(decisions, /aceptada[^\n]*único estado normativo/iu);
  assert.match(decisions, /propuesta[^\n]*no autoritativa/iu);
  assert.match(decisions, /reemplazada[^\n]*referencia[^\n]*sucesora/iu);

  const successor = decisions.match(/`\[[^\]]+\]\((#[^)]+)\)`/u)?.[1];
  assert.equal(successor, "#decision-sucesora");
  assert.doesNotMatch(decisions, /\[\[[^\]]+\]\]/u);
  assert.doesNotMatch(decisions, /^\s*-\s+\*\*(?:Owner|Responsable|Fecha|Milestone|Hito|Riesgo|Estado global):\*\*/imu);
});

test("documentación y plantillas no contradicen el ownership 0.3.1", async () => {
  const documents = await Promise.all([
    "README.md",
    "AGENTS.md",
    "AI_CONTEXT/CONTEXT.md",
    "templates/AGENTS.md",
    "templates/AI_CONTEXT/CONTEXT.md"
  ].map((relative) => readFile(path.join(projectRoot, relative), "utf8")));

  for (const content of documents) {
    assert.doesNotMatch(content, /\b(?:contenido|contexto) manual\b/iu);
  }

  const [readme, agents, , templateAgents, templateContext] = documents;
  assert.doesNotMatch(readme, /Project Brain[^\n]*(?:owners|fechas|riesgos|milestones|estado de gestión)/iu);
  assert.doesNotMatch(`${agents}\n${templateAgents}`, /Project Brain[^\n]*hechos verificables/iu);
  assert.match(templateAgents, /Project Brain[^\n]*GeneratedProjection/iu);
  assert.match(templateAgents, /RepositoryOwnedContent[^\n]*preserv/iu);
  assert.match(templateAgents, /observaciones[^\n]*detecciones[^\n]*comandos candidatos/iu);
  assert.match(templateContext, /^## Contexto del repositorio$/mu);
  assert.doesNotMatch(templateContext, /^## RepositoryOwnedContent$/mu);
});

test("las responsabilidades de Project Brain, Graphify y Obsidian son explícitas", async () => {
  const agents = await readFile(path.join(templatesRoot, "AGENTS.md"), "utf8");
  assert.match(agents, /Project Brain.*GeneratedProjection/i);
  assert.match(agents, /Graphify.*relaciones y visualizaciones/i);
  assert.match(agents, /Obsidian.*archivos Markdown/i);
  assert.match(agents, /no es contexto fuente/i);

  const contextNotes = (
    await Promise.all(
      REQUIRED_FILES.filter((relativePath) => relativePath !== "AGENTS.md").map((relativePath) =>
        readFile(path.join(templatesRoot, relativePath), "utf8")
      )
    )
  ).join("\n");
  assert.doesNotMatch(
    contextNotes,
    /\b(?:Project Brain|Graphify|Obsidian)\b/i,
    "la explicación de herramientas debe vivir solo en AGENTS.md"
  );

  const context = await readFile(path.join(templatesRoot, CONTRACT.generatedFile), "utf8");
  assert.equal(context.match(/<!-- brain:generated:start -->/g)?.length, 1);
  assert.equal(context.match(/<!-- brain:generated:end -->/g)?.length, 1);
});
