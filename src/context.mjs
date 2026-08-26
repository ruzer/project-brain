import { END_MARKER, START_MARKER } from "./contract.mjs";

function asList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, count]) => `${name} (${count})`);
  }
  return [];
}

function singleLine(value) {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function inlineText(value) {
  return singleLine(value).replace(/([\\`*_{}\[\]<>#+|])/gu, "\\$1");
}

function codeSpan(value) {
  const content = singleLine(value);
  const longestRun = Math.max(0, ...[...content.matchAll(/`+/gu)].map((match) => match[0].length));
  const fence = "`".repeat(longestRun + 1);
  const padded = content.startsWith("`") || content.endsWith("`") ? ` ${content} ` : content;
  return `${fence}${padded}${fence}`;
}

function compact(items, fallback, limit = 8) {
  const values = asList(items).map(inlineText);
  if (values.length === 0) return fallback;
  const visible = values.slice(0, limit);
  const remaining = values.length - visible.length;
  return `${visible.join(", ")}${remaining > 0 ? `, +${remaining} más` : ""}`;
}

function markdownLink(relativePath) {
  const value = String(relativePath);
  const label = inlineText(value);
  const target = `../${value.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
  return `[${label}](${target})`;
}

function fingerprintLabel(value) {
  const fingerprint = String(value ?? "desconocida");
  return fingerprint.startsWith("sha256:") ? fingerprint : `sha256:${fingerprint}`;
}

export function renderGeneratedBlock(facts) {
  const manifests = asList(facts.manifests);
  const commands = asList(facts.validationCommands);
  const lines = [
    START_MARKER,
    "## Hechos verificados del repositorio",
    "",
    `- Archivos analizados: ${Number(facts.fileCount ?? 0)}`,
    `- Huella del inventario: ${codeSpan(fingerprintLabel(facts.fingerprint))}`,
    `- Stack: ${compact(facts.stack, "no detectado")}`,
    `- Raíces principales: ${compact(facts.roots, "ninguna")}`,
    `- Lenguajes: ${compact(facts.languages, "no detectados")}`,
    `- Manifiestos: ${manifests.length > 0 ? manifests.map(markdownLink).join(", ") : "ninguno detectado"}`,
    "",
    "### Comandos de validación detectados",
    ""
  ];

  if (commands.length === 0) lines.push("- Ninguno detectado");
  else for (const command of commands) lines.push(`- ${codeSpan(command)}`);

  lines.push(END_MARKER);
  return lines.join("\n");
}

function occurrences(text, marker) {
  return text.split(marker).length - 1;
}

export function assertGeneratedBlock(text) {
  if (occurrences(text, START_MARKER) !== 1 || occurrences(text, END_MARKER) !== 1) {
    throw new Error("CONTEXT.md debe contener exactamente un bloque generado por Project Brain.");
  }
  const start = text.indexOf(START_MARKER);
  const end = text.indexOf(END_MARKER, start);
  if (end < start) throw new Error("Los marcadores generados de CONTEXT.md están desordenados.");
  return { start, end };
}

export function replaceGeneratedBlock(text, facts) {
  const { start, end } = assertGeneratedBlock(text);
  return text.slice(0, start) + renderGeneratedBlock(facts) + text.slice(end + END_MARKER.length);
}
