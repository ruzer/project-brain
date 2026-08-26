import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { doctor } from "../src/doctor.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const templateRoot = path.join(packageRoot, "templates");
const temporaryRoots = new Set();

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "project-brain-doctor-"));
  temporaryRoots.add(root);
  await mkdir(path.join(root, "AI_CONTEXT"), { recursive: true });
  await copyFile(path.join(templateRoot, "AGENTS.md"), path.join(root, "AGENTS.md"));
  for (const name of ["CONTEXT.md", "DECISIONS.md", "TASKS.md", "LEARNINGS.md"]) {
    await copyFile(
      path.join(templateRoot, "AI_CONTEXT", name),
      path.join(root, "AI_CONTEXT", name)
    );
  }
  return root;
}

async function append(relativeRoot, relativeFile, content) {
  const target = path.join(relativeRoot, relativeFile);
  const current = await readFile(target, "utf8");
  await writeFile(target, `${current}${content}`, "utf8");
}

function codes(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

test("acepta el contrato mínimo y entrega una estructura estable", async () => {
  const root = await createFixture();

  const first = await doctor(root);
  const second = await doctor(root);

  assert.deepEqual(second, first);
  assert.equal(first.ok, true);
  assert.deepEqual(first.errors, []);
  assert.deepEqual(first.warnings, []);
  assert.deepEqual(
    first.checks.map((check) => check.id),
    [
      "canonical-files",
      "generated-markers",
      "size-limits",
      "extra-context-files",
      "links",
      "duplicates",
      "sensitive-data"
    ]
  );
  assert.ok(first.checks.every((check) => check.ok));
});

test("reporta archivos canónicos ausentes y enlaces simbólicos sin seguirlos", async () => {
  const root = await createFixture();
  await unlink(path.join(root, "AI_CONTEXT", "TASKS.md"));
  await unlink(path.join(root, "AI_CONTEXT", "LEARNINGS.md"));
  await symlink("DECISIONS.md", path.join(root, "AI_CONTEXT", "LEARNINGS.md"));

  const result = await doctor(root);

  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes("MISSING_CANONICAL_FILE"));
  assert.ok(codes(result.errors).includes("SYMLINK_CANONICAL_FILE"));
  assert.ok(
    result.errors.some(
      (diagnostic) =>
        diagnostic.code === "MISSING_CANONICAL_FILE" &&
        diagnostic.file === "AI_CONTEXT/TASKS.md"
    )
  );
});

test("exige una sola pareja ordenada de marcadores generados", async () => {
  const root = await createFixture();
  await append(root, "AI_CONTEXT/CONTEXT.md", "\n<!-- brain:generated:start -->\n");

  const result = await doctor(root);

  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes("GENERATED_START_MARKER_COUNT"));
});

test("advierte límites por bytes, líneas y tamaño total", async () => {
  const root = await createFixture();
  await append(root, "AI_CONTEXT/DECISIONS.md", `\n${"línea\n".repeat(241)}`);
  await append(root, "AI_CONTEXT/LEARNINGS.md", `\n${"x".repeat(13_000)}\n`);
  for (const file of [
    "AGENTS.md",
    "AI_CONTEXT/CONTEXT.md",
    "AI_CONTEXT/DECISIONS.md",
    "AI_CONTEXT/TASKS.md",
    "AI_CONTEXT/LEARNINGS.md"
  ]) {
    await append(root, file, `\n${"z".repeat(8_000)}\n`);
  }

  const result = await doctor(root);
  const warningCodes = codes(result.warnings);

  assert.ok(warningCodes.includes("FILE_BYTES_EXCEEDED"));
  assert.ok(warningCodes.includes("FILE_LINES_EXCEEDED"));
  assert.ok(warningCodes.includes("TOTAL_BYTES_EXCEEDED"));
});

test("detecta archivos extra y enlaces Markdown y wikilinks rotos", async () => {
  const root = await createFixture();
  await writeFile(path.join(root, "AI_CONTEXT", "EXTRA.md"), "# Extra\n", "utf8");
  await append(
    root,
    "AI_CONTEXT/TASKS.md",
    "\n- [Documento ausente](missing.md)\n- [[Nota inexistente]]\n"
  );

  const result = await doctor(root);

  assert.equal(result.ok, false);
  assert.ok(codes(result.warnings).includes("EXTRA_CONTEXT_FILE"));
  assert.ok(codes(result.errors).includes("BROKEN_MARKDOWN_LINK"));
  assert.ok(codes(result.errors).includes("BROKEN_WIKILINK"));
});

test("rechaza enlaces que escapan mediante symlinks y reconoce destinos CommonMark", async () => {
  const root = await createFixture();
  const outside = await mkdtemp(path.join(tmpdir(), "project-brain-outside-"));
  temporaryRoots.add(outside);
  await writeFile(path.join(outside, "outside.md"), "# Fuera\n", "utf8");
  await symlink(outside, path.join(root, "linked"));
  await symlink("destino-inexistente", path.join(root, "dangling"));
  await append(
    root,
    "AI_CONTEXT/TASKS.md",
    [
      "",
      "- [Escape](../linked/outside.md)",
      "- [Colgante](../dangling/missing.md)",
      "- [Paréntesis](missing(1).md)",
      "- [Espacio](missing\\ file.md)",
      ""
    ].join("\n")
  );

  const result = await doctor(root);
  assert.ok(codes(result.errors).includes("RELATIVE_LINK_OUTSIDE_ROOT"));
  assert.ok(result.errors.filter((diagnostic) => diagnostic.code === "BROKEN_MARKDOWN_LINK").length >= 3);
});

test("resuelve caracteres reservados codificados antes de interpretar fragmentos", async () => {
  const root = await createFixture();
  await writeFile(path.join(root, "AI_CONTEXT", "file#name.md"), "# Hash\n", "utf8");
  const links = ["- [Hash](file%23name.md)"];
  if (process.platform !== "win32") {
    await writeFile(path.join(root, "AI_CONTEXT", "file?name.md"), "# Query\n", "utf8");
    links.push("- [Query](file%3Fname.md)");
  }
  await append(root, "AI_CONTEXT/TASKS.md", `\n${links.join("\n")}\n`);

  const result = await doctor(root);
  assert.equal(result.errors.some((diagnostic) => diagnostic.code === "BROKEN_MARKDOWN_LINK"), false);
});

test("no confunde texto o código inline con enlaces Markdown", async () => {
  const root = await createFixture();
  await append(
    root,
    "AI_CONTEXT/TASKS.md",
    "\nTexto literal array](missing.md)\nCódigo: ``array](also-missing.md)``\n"
  );

  const result = await doctor(root);
  assert.equal(result.errors.some((diagnostic) => diagnostic.code === "BROKEN_MARKDOWN_LINK"), false);
});

test("advierte duplicados y datos personales, y rechaza secretos materiales", async () => {
  const root = await createFixture();
  const repeated =
    "Este bloque confirmado explica una restricción operativa importante y debe existir en una sola nota para evitar versiones contradictorias durante el trabajo futuro.";
  await append(root, "AI_CONTEXT/DECISIONS.md", `\n## Regla repetida\n\n${repeated}\n`);
  await append(root, "AI_CONTEXT/LEARNINGS.md", `\n## Regla repetida\n\n${repeated}\n`);
  await append(
    root,
    "AI_CONTEXT/TASKS.md",
    [
      "",
      "ACCESS_TOKEN=\"ghp_abcdefghijklmnopqrstuvwxyz123456\"",
      "AWS_SECRET_ACCESS_KEY=material-aws-secret-value",
      "STRIPE_SECRET_KEY=material-stripe-secret-value",
      "GITHUB_TOKEN=material-github-token-value",
      "Correo operativo: persona@dominio.mx",
      "Teléfono: +52 662 123 4567",
      "Ejemplos inocuos: user@example.com, +1 202-555-0123 y TOKEN=<YOUR_TOKEN>",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "contenido-no-real",
      "-----END OPENSSH PRIVATE KEY-----",
      ""
    ].join("\n")
  );
  await writeFile(
    path.join(root, "AI_CONTEXT", "EXTRA.md"),
    "API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456\n",
    "utf8"
  );

  const result = await doctor(root);
  const errorCodes = codes(result.errors);
  const warningCodes = codes(result.warnings);

  assert.equal(result.ok, false);
  assert.ok(errorCodes.includes("EXPOSED_TOKEN"));
  assert.ok(errorCodes.includes("PRIVATE_KEY"));
  assert.ok(errorCodes.includes("EXPOSED_CREDENTIAL"));
  assert.ok(
    result.errors.some(
      (diagnostic) => diagnostic.code === "EXPOSED_TOKEN" && diagnostic.file === "AI_CONTEXT/EXTRA.md"
    )
  );
  assert.ok(warningCodes.includes("SIGNIFICANT_DUPLICATE"));
  assert.ok(warningCodes.includes("PERSONAL_EMAIL"));
  assert.ok(warningCodes.includes("PERSONAL_PHONE"));
  assert.equal(
    result.warnings.filter((diagnostic) => diagnostic.code === "PERSONAL_EMAIL").length,
    1
  );
  assert.equal(
    result.warnings.filter((diagnostic) => diagnostic.code === "PERSONAL_PHONE").length,
    1
  );
});

test("no carga archivos extra de texto desproporcionados", async () => {
  const root = await createFixture();
  await writeFile(
    path.join(root, "AI_CONTEXT", "HUGE.md"),
    "x".repeat(1024 * 1024 + 1),
    "utf8"
  );

  const result = await doctor(root);
  assert.equal(result.ok, false);
  assert.ok(codes(result.errors).includes("CONTENT_TOO_LARGE_TO_AUDIT"));
});

test("detecta bloques de llave privada PGP", async () => {
  const root = await createFixture();
  await append(
    root,
    "AI_CONTEXT/LEARNINGS.md",
    "\n-----BEGIN PGP PRIVATE KEY BLOCK-----\nmaterial\n-----END PGP PRIVATE KEY BLOCK-----\n"
  );

  const result = await doctor(root);
  assert.ok(codes(result.errors).includes("PRIVATE_KEY"));
});

test("detecta tokens npm en sintaxis npmrc", async () => {
  const root = await createFixture();
  await append(
    root,
    "AI_CONTEXT/TASKS.md",
    "\n//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz1234567890\n"
  );

  const result = await doctor(root);
  assert.ok(codes(result.errors).includes("EXPOSED_TOKEN"));
});
