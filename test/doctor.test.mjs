import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GENERATED_FILE, REQUIRED_FILES } from "../src/contract.mjs";
import { doctor, doctorRepository, initRepository, syncRepository } from "../src/index.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const templateRoot = path.join(packageRoot, "templates");
const temporaryRoots = new Set();
const ARTIFACT_ROLES = new Map([
  ["AI_CONTEXT/CONTEXT.md", "context"],
  ["AI_CONTEXT/DECISIONS.md", "decisions"],
  ["AI_CONTEXT/TASKS.md", "tasks"],
  ["AI_CONTEXT/LEARNINGS.md", "learnings"]
]);

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
  await syncRepository(root);
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

function assertDiagnosticListMetadata(diagnostics, severity) {
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.severity, severity);
    assert.equal(typeof diagnostic.checkId, "string");
    assert.equal(typeof diagnostic.code, "string");
    assert.equal(typeof diagnostic.file, "string");
    assert.equal(typeof diagnostic.message, "string");
  }
}

function assertDiagnosticMetadata(result) {
  assertDiagnosticListMetadata(result.errors, "error");
  assertDiagnosticListMetadata(result.warnings, "warning");
}

function assertDiagnosticCounts(result) {
  for (const check of result.checks) {
    assert.equal(
      check.errors,
      result.errors.filter((diagnostic) => diagnostic.checkId === check.id).length
    );
    assert.equal(
      check.warnings,
      result.warnings.filter((diagnostic) => diagnostic.checkId === check.id).length
    );
  }
}

async function canonicalState(root) {
  return {
    files: Object.fromEntries(await Promise.all(REQUIRED_FILES.map(async (relative) => {
      const filePath = path.join(root, relative);
      const info = await stat(filePath);
      return [relative, {
        bytes: await readFile(filePath),
        ino: info.ino,
        mode: info.mode,
        mtimeMs: info.mtimeMs,
        size: info.size
      }];
    }))),
    rootEntries: (await readdir(root)).sort(),
    contextEntries: (await readdir(path.join(root, "AI_CONTEXT"))).sort()
  };
}

function staleWarnings(result) {
  return result.warnings.filter((diagnostic) => diagnostic.code === "STALE_GENERATED_PROJECTION");
}

function roleWarnings(result) {
  return result.warnings.filter((diagnostic) => diagnostic.checkId === "artifact-roles");
}

async function writeArtifactFrontmatter(root, relative, frontmatter) {
  const target = path.join(root, relative);
  const content = await readFile(target, "utf8");
  const match = content.match(/^\uFEFF?---(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---(?:\r\n|\r|\n)/u);
  assert.ok(match, `fixture sin frontmatter inicial: ${relative}`);
  await writeFile(target, `${frontmatter}${content.slice(match[0].length)}`, "utf8");
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
      "sensitive-data",
      "artifact-roles",
      "generated-freshness"
    ]
  );
  assert.ok(first.checks.every((check) => check.ok));
});

test("artifact-roles advierte drift sin corregir contenido repository-owned", async (t) => {
  await t.test("frontmatter ausente y malformado producen warnings diferenciados", async () => {
    const missingRoot = await createFixture();
    await writeArtifactFrontmatter(missingRoot, "AI_CONTEXT/TASKS.md", "");
    const missing = await doctor(missingRoot);

    assert.equal(missing.ok, true);
    assert.deepEqual(codes(roleWarnings(missing)), ["MISSING_ARTIFACT_FRONTMATTER"]);
    assert.deepEqual(
      missing.checks.find((check) => check.id === "artifact-roles"),
      { id: "artifact-roles", ok: true, errors: 0, warnings: 1 }
    );

    for (const frontmatter of [
      "---\nproject_brain: 1\nrole: tasks\n",
      "---\nproject_brain: 1\nrole: tasks\nrole: tasks\n---\n",
      "---\nproject_brain: 1\nesta línea no es un campo\n---\n"
    ]) {
      const malformedRoot = await createFixture();
      await writeArtifactFrontmatter(malformedRoot, "AI_CONTEXT/TASKS.md", frontmatter);
      const malformed = await doctor(malformedRoot);

      assert.equal(malformed.ok, true);
      assert.deepEqual(codes(roleWarnings(malformed)), ["MALFORMED_ARTIFACT_FRONTMATTER"]);
    }
  });

  await t.test("marcador y role ausentes o inválidos se distinguen", async () => {
    const cases = [
      {
        frontmatter: "---\nrole: tasks\n---\n",
        code: "INVALID_PROJECT_BRAIN_MARKER"
      },
      {
        frontmatter: "---\nproject_brain: 2\nrole: tasks\n---\n",
        code: "INVALID_PROJECT_BRAIN_MARKER"
      },
      {
        frontmatter: "---\nproject_brain: 1\n---\n",
        code: "MISSING_ARTIFACT_ROLE"
      },
      {
        frontmatter: "---\nproject_brain: 1\nrole: roadmap\n---\n",
        code: "UNKNOWN_ARTIFACT_ROLE"
      }
    ];

    for (const { frontmatter, code } of cases) {
      const root = await createFixture();
      await writeArtifactFrontmatter(root, "AI_CONTEXT/TASKS.md", frontmatter);
      const result = await doctor(root);

      assert.equal(result.ok, true);
      assert.deepEqual(codes(roleWarnings(result)), [code]);
      assert.equal(roleWarnings(result)[0].file, "AI_CONTEXT/TASKS.md");
      assert.equal(roleWarnings(result)[0].severity, "warning");
    }
  });

  await t.test("cada ruta exige su role correspondiente", async () => {
    for (const [relative, expectedRole] of ARTIFACT_ROLES) {
      const root = await createFixture();
      const otherRole = expectedRole === "context" ? "tasks" : "context";
      const target = path.join(root, relative);
      const content = await readFile(target, "utf8");
      await writeFile(target, content.replace(`role: ${expectedRole}`, `role: ${otherRole}`), "utf8");

      const result = await doctor(root);
      const warnings = roleWarnings(result);
      assert.equal(result.ok, true);
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].code, "ARTIFACT_ROLE_MISMATCH");
      assert.equal(warnings[0].file, relative);
      assert.equal(warnings[0].expected, expectedRole);
      assert.equal(warnings[0].actual, otherRole);
    }
  });

  await t.test("acepta BOM, line endings y campos en distinto orden; AGENTS queda exento", async () => {
    const root = await createFixture();
    await writeArtifactFrontmatter(
      root,
      "AI_CONTEXT/TASKS.md",
      "\uFEFF---\r\nrole: tasks\r\nextra: permitido\r\nproject_brain: 1\r\n---\r\n"
    );

    const result = await doctor(root);

    assert.deepEqual(roleWarnings(result), []);
    assert.deepEqual(
      result.checks.find((check) => check.id === "artifact-roles"),
      { id: "artifact-roles", ok: true, errors: 0, warnings: 0 }
    );
    assert.equal(result.warnings.some((diagnostic) => diagnostic.file === "AGENTS.md"), false);
  });

  await t.test("doctor, sync e init preservan exactamente los bytes con warning", async () => {
    const root = await createFixture();
    await writeArtifactFrontmatter(root, "AI_CONTEXT/TASKS.md", "");
    const before = await canonicalState(root);

    const firstDoctor = await doctor(root);
    assert.deepEqual(codes(roleWarnings(firstDoctor)), ["MISSING_ARTIFACT_FRONTMATTER"]);
    assert.deepEqual(await canonicalState(root), before);

    const synced = await syncRepository(root);
    assert.equal(synced.changed, false);
    assert.deepEqual(await canonicalState(root), before);

    const initialized = await initRepository(root);
    assert.deepEqual(initialized.created, []);
    assert.deepEqual(initialized.preserved, REQUIRED_FILES);
    assert.equal(initialized.changed, false);
    assert.deepEqual(await canonicalState(root), before);
    assert.deepEqual(codes(roleWarnings(await doctor(root))), ["MISSING_ARTIFACT_FRONTMATTER"]);
  });
});

test("generated-freshness compara la proyección esperada sin escribir", async (t) => {
  await t.test("bloque manipulado produce warning y sync lo elimina", async () => {
    const root = await createFixture();
    const contextPath = path.join(root, GENERATED_FILE);
    const current = await readFile(contextPath, "utf8");
    await writeFile(
      contextPath,
      current.replace(/Archivos observados: \d+/u, "Archivos observados: 999"),
      "utf8"
    );
    const beforeDoctor = await canonicalState(root);

    const first = await doctor(root);
    const second = await doctor(root);

    assert.equal(first.ok, true);
    assert.deepEqual(second, first);
    assert.equal(staleWarnings(first).length, 1);
    assert.equal(staleWarnings(first)[0].checkId, "generated-freshness");
    assert.equal(staleWarnings(first)[0].severity, "warning");
    assert.deepEqual(await canonicalState(root), beforeDoctor);

    const synced = await syncRepository(root);
    assert.equal(synced.changed, true);
    assert.equal(staleWarnings(await doctor(root)).length, 0);
  });

  await t.test("archivo añadido y eliminado desactualiza la proyección", async () => {
    const root = await createFixture();
    const sourcePath = path.join(root, "src", "value.js");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "export const value = 1;\n", "utf8");

    assert.equal(staleWarnings(await doctor(root)).length, 1);
    await syncRepository(root);
    assert.equal(staleWarnings(await doctor(root)).length, 0);

    await unlink(sourcePath);
    assert.equal(staleWarnings(await doctor(root)).length, 1);
  });

  await t.test("cambios de manifest, stack y scripts desactualizan la proyección", async () => {
    const root = await createFixture();
    const manifestPath = path.join(root, "package.json");
    await writeFile(manifestPath, JSON.stringify({
      engines: { node: ">=20" },
      scripts: { test: "node --test" }
    }), "utf8");

    assert.equal(staleWarnings(await doctor(root)).length, 1);
    await syncRepository(root);
    assert.equal(staleWarnings(await doctor(root)).length, 0);

    await writeFile(manifestPath, JSON.stringify({
      engines: { node: ">=20" },
      scripts: { check: "node --check index.js" }
    }), "utf8");
    assert.equal(staleWarnings(await doctor(root)).length, 1);
  });

  await t.test("igual tamaño sólo avisa cuando cambia la semántica proyectada", async () => {
    const root = await createFixture();
    const sourcePath = path.join(root, "value.js");
    await writeFile(sourcePath, "abc\n", "utf8");
    await syncRepository(root);
    await writeFile(sourcePath, "xyz\n", "utf8");

    assert.equal(staleWarnings(await doctor(root)).length, 0);

    const manifestPath = path.join(root, "package.json");
    const withLint = '{"scripts":{"lint":"echo x"}}\n';
    const withTest = '{"scripts":{"test":"echo x"}}\n';
    assert.equal(Buffer.byteLength(withLint), Buffer.byteLength(withTest));
    await writeFile(manifestPath, withLint, "utf8");
    await syncRepository(root);
    await writeFile(manifestPath, withTest, "utf8");

    assert.equal(staleWarnings(await doctor(root)).length, 1);
  });
});

test("cada Diagnostic expone checkId y severity sin alterar resultados existentes", async (t) => {
  await t.test("fixture warning-only conserva ok true y deduplicación", async () => {
    const root = await createFixture();
    await append(
      root,
      "AI_CONTEXT/TASKS.md",
      "\nContacto duplicado en la misma línea: persona@dominio.mx persona@dominio.mx\n"
    );

    const result = await doctor(root);

    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(
      result.warnings.filter((diagnostic) => diagnostic.code === "PERSONAL_EMAIL").length,
      1
    );
    assert.equal(
      result.warnings.find((diagnostic) => diagnostic.code === "PERSONAL_EMAIL")?.checkId,
      "sensitive-data"
    );
    assertDiagnosticMetadata(result);
    assertDiagnosticCounts(result);
  });

  await t.test("fixture error-only conserva ok false", async () => {
    const root = await createFixture();
    await unlink(path.join(root, "AI_CONTEXT", "TASKS.md"));

    const result = await doctor(root);
    const missing = result.errors.find((diagnostic) => diagnostic.code === "MISSING_CANONICAL_FILE");

    assert.equal(result.ok, false);
    assert.equal(missing?.checkId, "canonical-files");
    assert.equal(missing?.severity, "error");
    assertDiagnosticMetadata(result);
    assertDiagnosticCounts(result);
  });

  await t.test("fixture mixta conserva arrays, orden, counts y alias", async () => {
    const root = await createFixture();
    await writeFile(path.join(root, "AI_CONTEXT", "EXTRA.md"), "# Extra\n", "utf8");
    await append(
      root,
      "AI_CONTEXT/TASKS.md",
      "\n- [Destino ausente](missing.md)\nContacto: persona@dominio.mx\n"
    );

    const first = await doctor(root);
    const second = await doctor(root);
    const throughAlias = await doctorRepository(root);

    assert.equal(first.ok, false);
    assert.ok(first.errors.some((diagnostic) =>
      diagnostic.code === "BROKEN_MARKDOWN_LINK" && diagnostic.checkId === "links"
    ));
    assert.ok(first.warnings.some((diagnostic) =>
      diagnostic.code === "EXTRA_CONTEXT_FILE" && diagnostic.checkId === "extra-context-files"
    ));
    assert.ok(first.warnings.some((diagnostic) =>
      diagnostic.code === "PERSONAL_EMAIL" && diagnostic.checkId === "sensitive-data"
    ));
    assert.deepEqual(second, first);
    assert.deepEqual(throughAlias, first);
    assertDiagnosticMetadata(first);
    assertDiagnosticCounts(first);
  });
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
  assert.equal(staleWarnings(result).length, 0);
});

test("doctor informa UTF-8 inválido en CONTEXT.md y permanece read-only", async () => {
  const root = await createFixture();
  const contextPath = path.join(root, "AI_CONTEXT", "CONTEXT.md");
  const original = await readFile(contextPath);
  const marker = original.indexOf(Buffer.from("<!-- brain:generated:start -->"));
  const invalid = Buffer.concat([
    original.subarray(0, marker),
    Buffer.from([0x80]),
    original.subarray(marker)
  ]);
  await writeFile(contextPath, invalid);
  const beforeEntries = (await readdir(path.join(root, "AI_CONTEXT"))).sort();

  const result = await doctorRepository(root);

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((diagnostic) =>
    diagnostic.code === "UNREADABLE_CANONICAL_FILE" &&
    diagnostic.file === "AI_CONTEXT/CONTEXT.md" &&
    diagnostic.reason === "INVALID_UTF8"
  ));
  assert.deepEqual(await readFile(contextPath), invalid);
  assert.deepEqual((await readdir(path.join(root, "AI_CONTEXT"))).sort(), beforeEntries);
  assert.equal(beforeEntries.some((name) => name.endsWith(".tmp")), false);
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

test("IntegrationReference conserva auditoría local sin consultar destinos remotos", async () => {
  const root = await createFixture();
  const remote = "https://memory.example.invalid/projects/project-brain";
  await append(
    root,
    "AI_CONTEXT/TASKS.md",
    "\n- [Contexto local](CONTEXT.md)\n- [Local ausente](missing.md)\n- [Destino remoto](" +
      remote +
      ")\n"
  );

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("doctor no debe consultar la red");
  };

  let result;
  try {
    result = await doctor(root);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCalled, false);
  assert.ok(result.errors.some((diagnostic) =>
    diagnostic.code === "BROKEN_MARKDOWN_LINK" && diagnostic.target === "missing.md"
  ));
  assert.equal(result.errors.some((diagnostic) => diagnostic.target === "CONTEXT.md"), false);
  assert.equal(
    [...result.errors, ...result.warnings].some((diagnostic) => diagnostic.target === remote),
    false
  );
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
