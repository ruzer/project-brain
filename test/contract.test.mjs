import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CONTRACT,
  CONTRACT_SCHEMA,
  doctor,
  doctorRepository,
  initRepository,
  scanRepository,
  syncRepository
} from "@ruzer/project-brain";
import { put, temporaryRepository } from "../test-support/helpers.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const definitionNames = [
  "Diagnostic",
  "DoctorCheckResult",
  "DoctorResult",
  "InitResult",
  "RepositoryObservation",
  "SyncResult"
];

function assertDefinitionsPublished() {
  for (const name of definitionNames) {
    assert.ok(Object.hasOwn(CONTRACT_SCHEMA.$defs ?? {}, name), `falta $defs.${name}`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function resolveSchema(schema) {
  if (!schema?.$ref) return schema;
  assert.match(schema.$ref, /^#\//u, `referencia no local: ${schema.$ref}`);
  return schema.$ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((value, part) => value?.[part], CONTRACT_SCHEMA);
}

function validationErrors(value, candidate, location = "$") {
  const schema = resolveSchema(candidate);
  if (!schema) return [`${location}: schema ausente`];
  const errors = [];

  for (const child of schema.allOf ?? []) {
    errors.push(...validationErrors(value, child, location));
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (child) => validationErrors(value, child, location).length === 0
    ).length;
    if (matches !== 1) errors.push(`${location}: se esperaba exactamente una rama de oneOf`);
  }

  if (Object.hasOwn(schema, "const") && !sameJson(value, schema.const)) {
    errors.push(`${location}: valor distinto de const`);
  }
  if (schema.enum && !schema.enum.some((entry) => sameJson(value, entry))) {
    errors.push(`${location}: valor fuera de enum`);
  }

  const types = schema.type === undefined
    ? []
    : Array.isArray(schema.type) ? schema.type : [schema.type];
  const typeMatches = (type) => (
    type === "array" ? Array.isArray(value)
      : type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value)
        : type === "integer" ? Number.isInteger(value)
          : type === "number" ? typeof value === "number" && Number.isFinite(value)
            : type === "null" ? value === null
              : typeof value === type
  );
  if (types.length > 0 && !types.some(typeMatches)) {
    return [...errors, `${location}: tipo incompatible`];
  }

  if (types.includes("object") && typeMatches("object")) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location}.${key}: campo requerido ausente`);
    }
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) {
        errors.push(...validationErrors(value[key], child, `${location}.${key}`));
      }
    }
    for (const [key, childValue] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${location}.${key}: campo adicional no permitido`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(...validationErrors(childValue, schema.additionalProperties, `${location}.${key}`));
      }
    }
  } else if (types.includes("array") && typeMatches("array")) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: menos de ${schema.minItems} elementos`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${location}: más de ${schema.maxItems} elementos`);
    }
    if (schema.uniqueItems && new Set(value.map((entry) => JSON.stringify(entry))).size !== value.length) {
      errors.push(`${location}: elementos duplicados`);
    }
    for (let index = 0; index < value.length; index += 1) {
      const child = schema.prefixItems?.[index] ?? schema.items;
      if (child) errors.push(...validationErrors(value[index], child, `${location}[${index}]`));
    }
  } else if (types.includes("string") && typeMatches("string")) {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: string demasiado corto`);
    }
    if (schema.pattern && !(new RegExp(schema.pattern, "u")).test(value)) {
      errors.push(`${location}: string fuera de pattern`);
    }
  } else if (
    (types.includes("integer") && typeMatches("integer"))
    || (types.includes("number") && typeMatches("number"))
  ) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location}: valor menor que ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location}: valor mayor que ${schema.maximum}`);
    }
  }

  return errors;
}

function assertMatches(value, definitionName) {
  const serializable = JSON.parse(JSON.stringify(value));
  assert.deepEqual(
    validationErrors(serializable, { $ref: `#/$defs/${definitionName}` }),
    [],
    `${definitionName} no coincide con el contrato`
  );
}

function assertDoesNotMatch(value, definitionName) {
  const serializable = JSON.parse(JSON.stringify(value));
  assert.ok(
    validationErrors(serializable, { $ref: `#/$defs/${definitionName}` }).length > 0,
    `${definitionName} aceptó una forma inválida`
  );
}

test("el contrato describe los resultados públicos reales de 0.3.x", async (t) => {
  assertDefinitionsPublished();

  const root = await temporaryRepository(t, "brain-contract-");
  await put(root, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
  const observation = await scanRepository(root);
  const errorResult = await doctor(root);
  const initialized = await initRepository(root);
  const synced = await syncRepository(root);
  const healthy = await doctorRepository(root);

  await put(
    root,
    "AI_CONTEXT/TASKS.md",
    [
      "---",
      "project_brain: 1",
      "role: tasks",
      "---",
      "",
      "# Tareas",
      "",
      "### IntegrationReference",
      "- **system:** `Project Memory Hub`",
      "- **provenance:** `AI_CONTEXT/TASKS.md#referencia`",
      "- **authority:** Project Memory Hub conserva el estado de gestión.",
      ""
    ].join("\n")
  );
  const warningOnly = await doctor(root);

  assertMatches(observation, "RepositoryObservation");
  assertMatches(errorResult, "DoctorResult");
  for (const diagnostic of errorResult.errors) assertMatches(diagnostic, "Diagnostic");
  assertMatches(initialized, "InitResult");
  assertMatches(synced, "SyncResult");
  assertMatches(healthy, "DoctorResult");
  assertMatches(warningOnly, "DoctorResult");
  for (const check of warningOnly.checks) assertMatches(check, "DoctorCheckResult");
  for (const diagnostic of warningOnly.warnings) assertMatches(diagnostic, "Diagnostic");

  assert.equal(warningOnly.ok, true);
  assert.deepEqual(warningOnly.errors, []);
  assert.ok(warningOnly.warnings.length > 0);
});

test("el contrato impone semántica de ok y severidad de los arrays", () => {
  const warningOnly = structuredClone(CONTRACT_SCHEMA.$defs.DoctorResult.examples[0]);
  const warningCheck = structuredClone(CONTRACT_SCHEMA.$defs.DoctorCheckResult.examples[0]);
  const errorDiagnostic = {
    ...structuredClone(CONTRACT_SCHEMA.$defs.Diagnostic.examples[0]),
    code: "MISSING_CANONICAL_FILE",
    checkId: "canonical-files",
    severity: "error"
  };
  const errorResult = {
    ok: false,
    errors: [errorDiagnostic],
    warnings: [],
    checks: [{ id: "canonical-files", ok: false, errors: 1, warnings: 0 }]
  };

  assertMatches(warningOnly, "DoctorResult");
  assertMatches(warningCheck, "DoctorCheckResult");
  assertMatches(errorResult, "DoctorResult");

  assertDoesNotMatch({ ...warningOnly, ok: false }, "DoctorResult");
  assertDoesNotMatch({ ...errorResult, ok: true }, "DoctorResult");
  assertDoesNotMatch(
    { ...warningOnly, warnings: [{ ...warningOnly.warnings[0], severity: "error" }] },
    "DoctorResult"
  );
  assertDoesNotMatch({ ...warningCheck, ok: false }, "DoctorCheckResult");
  assertDoesNotMatch(
    { ...warningCheck, ok: true, errors: 1, warnings: 0 },
    "DoctorCheckResult"
  );
});

test("todos los ejemplos del contrato se verifican automáticamente", () => {
  assertDefinitionsPublished();
  for (const name of definitionNames) {
    const examples = CONTRACT_SCHEMA.$defs[name].examples;
    assert.ok(Array.isArray(examples) && examples.length > 0, `${name} no publica ejemplos`);
    for (const example of examples) assertMatches(example, name);
  }
});

test("los contratos son aditivos y preservan los campos existentes", () => {
  assertDefinitionsPublished();
  for (const name of definitionNames) {
    const definition = CONTRACT_SCHEMA.$defs[name];
    const example = structuredClone(definition.examples[0]);
    assert.equal(definition.additionalProperties, true, `${name} debe admitir campos aditivos`);
    assertMatches({ ...example, futureField: "aditivo" }, name);

    for (const required of definition.required) {
      const incomplete = structuredClone(example);
      delete incomplete[required];
      assert.ok(
        validationErrors(incomplete, { $ref: `#/$defs/${name}` }).length > 0,
        `${name}.${required} dejó de ser requerido`
      );
    }
  }

  const legacyConsumer = ({ fileCount, fingerprint, roots, extensions, languages, manifests, stack, validationCommands }) => ({
    fileCount,
    fingerprint,
    roots,
    extensions,
    languages,
    manifests,
    stack,
    validationCommands
  });
  const observation = CONTRACT_SCHEMA.$defs.RepositoryObservation.examples[0];
  assert.deepEqual(
    legacyConsumer({ ...observation, futureField: true }),
    legacyConsumer(observation)
  );
});

test("RepositoryObservation publica inventoryMode como campo aditivo", () => {
  const definition = CONTRACT_SCHEMA.$defs.RepositoryObservation;
  const example = structuredClone(definition.examples[0]);

  assert.deepEqual(definition.properties.inventoryMode, {
    type: "string",
    enum: ["git", "filesystem"],
    description: "Modo único usado para construir el inventario local."
  });
  assert.equal(definition.required.includes("inventoryMode"), false);
  assertMatches({ ...example, inventoryMode: "git" }, "RepositoryObservation");
  assertMatches({ ...example, inventoryMode: "filesystem" }, "RepositoryObservation");
  assertMatches(
    Object.fromEntries(Object.entries(example).filter(([key]) => key !== "inventoryMode")),
    "RepositoryObservation"
  );
  assertDoesNotMatch({ ...example, inventoryMode: "unknown" }, "RepositoryObservation");
});

test("CONTRACT_SCHEMA conserva el export raíz y el subpath publicado", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const schemaFromSubpath = require("@ruzer/project-brain/schema");

  assert.equal(packageJson.exports["."], "./src/index.mjs");
  assert.equal(packageJson.exports["./schema"], "./schema/context-contract.schema.json");
  assert.deepEqual(schemaFromSubpath, CONTRACT_SCHEMA);
  assert.deepEqual(CONTRACT_SCHEMA.default, CONTRACT);
});
