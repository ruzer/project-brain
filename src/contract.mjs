import { readFileSync } from "node:fs";

const schemaUrl = new URL("../schema/context-contract.schema.json", import.meta.url);
export const CONTRACT_SCHEMA = JSON.parse(readFileSync(schemaUrl, "utf8"));

const value = CONTRACT_SCHEMA.default;
if (
  !value ||
  value.contractVersion !== 1 ||
  !Array.isArray(value.files) ||
  value.files.length !== 5 ||
  !value.markers?.start ||
  !value.markers?.end
) {
  throw new Error("El contrato de contexto incluido no es válido.");
}

export const CONTRACT = Object.freeze({
  ...value,
  files: Object.freeze([...value.files]),
  markers: Object.freeze({ ...value.markers }),
  limits: Object.freeze({ ...value.limits })
});

export const REQUIRED_FILES = CONTRACT.files;
export const GENERATED_FILE = CONTRACT.generatedFile;
export const START_MARKER = CONTRACT.markers.start;
export const END_MARKER = CONTRACT.markers.end;
export const LIMITS = CONTRACT.limits;
