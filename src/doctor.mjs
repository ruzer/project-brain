import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  END_MARKER,
  GENERATED_FILE,
  LIMITS,
  REQUIRED_FILES,
  START_MARKER
} from "./contract.mjs";
import { replaceGeneratedBlock } from "./context.mjs";
import { insideRoot, managedPath, readText, resolveRoot } from "./fs.mjs";
import { scanRepository } from "./scanner.mjs";

const CHECK_IDS = Object.freeze([
  "canonical-files",
  "generated-markers",
  "size-limits",
  "extra-context-files",
  "links",
  "duplicates",
  "sensitive-data",
  "artifact-roles",
  "generated-freshness",
  "integration-references"
]);

const CONTEXT_DIRECTORY = "AI_CONTEXT";
const MAX_AUDIT_FILE_BYTES = 1024 * 1024;
const AUDITABLE_EXTRA_NAMES = /(?:\.md|\.markdown|\.txt|\.json|\.ya?ml|\.toml|\.ini|\.cfg|\.conf|\.env)$/iu;
const REQUIRED_CONTEXT_FILES = new Set(
  REQUIRED_FILES.filter((file) => file.startsWith(`${CONTEXT_DIRECTORY}/`))
);
const ARTIFACT_ROLES = new Map([
  ["AI_CONTEXT/CONTEXT.md", "context"],
  ["AI_CONTEXT/DECISIONS.md", "decisions"],
  ["AI_CONTEXT/TASKS.md", "tasks"],
  ["AI_CONTEXT/LEARNINGS.md", "learnings"]
]);
const KNOWN_ARTIFACT_ROLES = new Set(ARTIFACT_ROLES.values());
const INTEGRATION_REFERENCE_FIELDS = Object.freeze([
  "system",
  "destination",
  "provenance",
  "authority"
]);

function compareText(left = "", right = "") {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareDiagnostics(left, right) {
  return (
    compareText(left.file, right.file) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.code, right.code) ||
    compareText(left.target, right.target) ||
    compareText(left.relatedFile, right.relatedFile)
  );
}

function createRecorder() {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const counts = new Map(CHECK_IDS.map((id) => [id, { errors: 0, warnings: 0 }]));

  function add(kind, check, diagnostic) {
    const normalized = {
      code: diagnostic.code,
      file: diagnostic.file ?? ".",
      message: diagnostic.message,
      ...diagnostic,
      checkId: check,
      severity: kind === "errors" ? "error" : "warning"
    };
    const key = [
      kind,
      check,
      normalized.code,
      normalized.file,
      normalized.line ?? "",
      normalized.target ?? "",
      normalized.relatedFile ?? ""
    ].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    (kind === "errors" ? errors : warnings).push(normalized);
    counts.get(check)[kind] += 1;
  }

  return {
    error(check, diagnostic) {
      add("errors", check, diagnostic);
    },
    warning(check, diagnostic) {
      add("warnings", check, diagnostic);
    },
    result() {
      errors.sort(compareDiagnostics);
      warnings.sort(compareDiagnostics);
      return {
        ok: errors.length === 0,
        errors,
        warnings,
        checks: CHECK_IDS.map((id) => {
          const count = counts.get(id);
          return {
            id,
            ok: count.errors === 0,
            errors: count.errors,
            warnings: count.warnings
          };
        })
      };
    }
  };
}

async function lstatIfPresent(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function lineCount(content) {
  if (content.length === 0) return 0;
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

function countOccurrences(content, marker) {
  let count = 0;
  let offset = 0;
  while (offset <= content.length - marker.length) {
    const index = content.indexOf(marker, offset);
    if (index === -1) break;
    count += 1;
    offset = index + marker.length;
  }
  return count;
}

function parseArtifactFrontmatter(content) {
  const source = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = source.split(/\r\n|\r|\n/u);
  if (lines[0] !== "---") return { status: "missing" };

  const end = lines.indexOf("---", 1);
  if (end === -1) return { status: "malformed" };

  const fields = new Map();
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const separator = line.indexOf(":");
    const key = separator > 0 ? line.slice(0, separator).trim() : "";
    if (!/^[a-z_][a-z\d_-]*$/iu.test(key) || fields.has(key)) {
      return { status: "malformed" };
    }
    fields.set(key, line.slice(separator + 1).trim());
  }

  return { status: "valid", fields };
}

function inspectArtifactRoles(canonical, recorder) {
  for (const [relative, expectedRole] of ARTIFACT_ROLES) {
    const note = canonical.get(relative);
    if (!note || note.bytes > MAX_AUDIT_FILE_BYTES) continue;

    const frontmatter = parseArtifactFrontmatter(note.content);
    if (frontmatter.status === "missing") {
      recorder.warning("artifact-roles", {
        code: "MISSING_ARTIFACT_FRONTMATTER",
        file: relative,
        message: "El artefacto canónico no tiene frontmatter inicial."
      });
      continue;
    }
    if (frontmatter.status === "malformed") {
      recorder.warning("artifact-roles", {
        code: "MALFORMED_ARTIFACT_FRONTMATTER",
        file: relative,
        message: "El frontmatter del artefacto canónico no usa el formato simple esperado."
      });
      continue;
    }

    const marker = frontmatter.fields.get("project_brain");
    if (marker !== "1") {
      recorder.warning("artifact-roles", {
        code: "INVALID_PROJECT_BRAIN_MARKER",
        file: relative,
        message: "El frontmatter debe declarar project_brain: 1.",
        actual: marker
      });
    }

    const role = frontmatter.fields.get("role");
    if (!role) {
      recorder.warning("artifact-roles", {
        code: "MISSING_ARTIFACT_ROLE",
        file: relative,
        message: "El frontmatter no declara el role del artefacto."
      });
    } else if (!KNOWN_ARTIFACT_ROLES.has(role)) {
      recorder.warning("artifact-roles", {
        code: "UNKNOWN_ARTIFACT_ROLE",
        file: relative,
        message: "El frontmatter declara un role desconocido.",
        actual: role
      });
    } else if (role !== expectedRole) {
      recorder.warning("artifact-roles", {
        code: "ARTIFACT_ROLE_MISMATCH",
        file: relative,
        message: "El role no corresponde a la ruta canónica del artefacto.",
        expected: expectedRole,
        actual: role
      });
    }
  }
}

async function collectExtraContextFiles(root, contextPath, recorder) {
  const files = [];

  async function visit(directory, relativeDirectory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      recorder.error("canonical-files", {
        code: "UNREADABLE_CONTEXT_DIRECTORY",
        file: relativeDirectory,
        message: "No se pudo leer el directorio de contexto.",
        reason: error?.code ?? error?.name ?? "UNKNOWN"
      });
      return;
    }

    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory.split(path.sep).join("/"), entry.name);
      const absolute = managedPath(root, relative);
      if (entry.isDirectory()) {
        await visit(absolute, relative);
      } else {
        files.push(relative);
      }
    }
  }

  await visit(contextPath, CONTEXT_DIRECTORY);
  return files.sort(compareText);
}

function markdownIndentWidth(prefix) {
  let width = 0;
  for (const character of prefix) {
    width = character === "\t" ? width + (4 - (width % 4)) : width + 1;
  }
  return width;
}

function markdownLines(content) {
  const output = [];
  const lines = content.split(/\r\n|\r|\n/);
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (fence) {
      const leadingWhitespace = line.match(/^[\t ]*/u)?.[0] ?? "";
      const leftContainer = (
        fence.indent > 0
        && line.trim()
        && markdownIndentWidth(leadingWhitespace) < fence.indent
      );
      if (leftContainer) {
        fence = null;
      } else {
        const closing = line.match(/^([\t ]*)(`{3,}|~{3,})/u);
        const marker = closing?.[2] ?? null;
        const indent = closing ? markdownIndentWidth(closing[1]) : -1;
        if (
          marker
          && marker[0] === fence.marker[0]
          && marker.length >= fence.marker.length
          && indent >= fence.indent
          && indent <= fence.indent + 3
          && /^[\t ]*$/u.test(line.slice(closing[0].length))
        ) fence = null;
        continue;
      }
    }

    const opening = line.match(
      /^( {0,3})(?:([-+*]|\d{1,9}[.)])([\t ]+))?(`{3,}|~{3,})/u
    );
    if (opening) {
      const marker = opening[4];
      fence = {
        indent: opening[2]
          ? markdownIndentWidth(line.slice(0, opening[0].length - marker.length))
          : 0,
        marker
      };
      continue;
    }

    output.push({ line: index + 1, raw: line, text: stripInlineCode(line) });
  }
  return output;
}

function stripInlineCode(line) {
  const characters = line.split("");
  let offset = 0;
  while (offset < line.length) {
    if (line[offset] !== "`") {
      offset += 1;
      continue;
    }
    let openingLength = 1;
    while (line[offset + openingLength] === "`") openingLength += 1;
    let candidate = offset + openingLength;
    let closing = -1;
    while (candidate < line.length) {
      if (line[candidate] !== "`") {
        candidate += 1;
        continue;
      }
      let candidateLength = 1;
      while (line[candidate + candidateLength] === "`") candidateLength += 1;
      if (candidateLength === openingLength) {
        closing = candidate;
        break;
      }
      candidate += candidateLength;
    }
    if (closing === -1) {
      offset += openingLength;
      continue;
    }
    characters.fill(" ", offset, closing + openingLength);
    offset = closing + openingLength;
  }
  return characters.join("");
}

function inspectIntegrationReferences(notes, recorder) {
  for (const [relative, note] of [...notes.entries()].sort(
    ([left], [right]) => compareText(left, right)
  )) {
    let current = null;
    let insideGeneratedProjection = false;

    const finish = () => {
      if (!current) return;
      const missingFields = INTEGRATION_REFERENCE_FIELDS.filter(
        (field) => !current.fields.has(field)
      );
      if (missingFields.length > 0) {
        recorder.warning("integration-references", {
          code: "INCOMPLETE_INTEGRATION_REFERENCE",
          file: relative,
          line: current.line,
          missingFields,
          message: "La IntegrationReference declarada está incompleta."
        });
      }
      current = null;
    };

    for (const entry of markdownLines(note.content)) {
      if (relative === GENERATED_FILE && entry.text.includes(START_MARKER)) {
        finish();
        insideGeneratedProjection = true;
        continue;
      }
      if (relative === GENERATED_FILE && entry.text.includes(END_MARKER)) {
        insideGeneratedProjection = false;
        continue;
      }
      if (insideGeneratedProjection) continue;

      const heading = entry.text.match(
        /^\s{0,3}(#{1,6})[\t ]+(.+?)(?:[\t ]+#+)?[\t ]*$/u
      );
      if (heading) {
        const level = heading[1].length;
        const label = heading[2].trim();
        if (current && (level <= current.level || label === "IntegrationReference")) finish();
        if (label === "IntegrationReference") {
          current = { fields: new Set(), level, line: entry.line };
        }
        continue;
      }

      if (!current) continue;
      const fieldMatch = entry.text.match(
        /^\s{0,3}-[\t ]+\*\*(system|destination|provenance|authority):\*\*/u
      );
      const field = fieldMatch?.[1];
      if (field && entry.raw.slice(fieldMatch[0].length).trim()) current.fields.add(field);
    }

    finish();
  }
}

function isEscaped(text, index) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function hasOpeningLabel(text, closer) {
  let depth = 0;
  for (let cursor = closer - 1; cursor >= 0; cursor -= 1) {
    if (isEscaped(text, cursor)) continue;
    if (text[cursor] === "]") depth += 1;
    else if (text[cursor] === "[") {
      if (depth === 0) return true;
      depth -= 1;
    }
  }
  return false;
}

function extractLinks(content) {
  const links = [];
  const referencePattern = /^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|(?:\\ |\S)+)/u;
  const wikiPattern = /!?\[\[([^\]]+)\]\]/gu;

  function inlineTargets(text) {
    const targets = [];
    let offset = 0;
    while (offset < text.length) {
      const opener = text.indexOf("](", offset);
      if (opener === -1) break;
      if (isEscaped(text, opener) || !hasOpeningLabel(text, opener)) {
        offset = opener + 2;
        continue;
      }
      let cursor = opener + 2;
      while (/\s/u.test(text[cursor] ?? "")) cursor += 1;
      const start = cursor;

      if (text[cursor] === "<") {
        cursor += 1;
        let escaped = false;
        while (cursor < text.length) {
          const character = text[cursor];
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === ">") {
            cursor += 1;
            break;
          }
          cursor += 1;
        }
      } else {
        let depth = 0;
        let escaped = false;
        while (cursor < text.length) {
          const character = text[cursor];
          if (escaped) escaped = false;
          else if (character === "\\") escaped = true;
          else if (character === "(") depth += 1;
          else if (character === ")") {
            if (depth === 0) break;
            depth -= 1;
          } else if (/\s/u.test(character) && depth === 0) break;
          cursor += 1;
        }
      }

      const target = text.slice(start, cursor);
      if (target) targets.push({ target, column: opener });
      offset = Math.max(cursor + 1, opener + 2);
    }
    return targets;
  }

  for (const entry of markdownLines(content)) {
    let match;
    for (const inline of inlineTargets(entry.text)) {
      links.push({ type: "markdown", target: inline.target, line: entry.line, column: inline.column });
    }

    const reference = entry.text.match(referencePattern);
    if (reference) {
      links.push({
        type: "markdown",
        target: reference[1],
        line: entry.line,
        column: entry.text.indexOf(reference[1])
      });
    }

    wikiPattern.lastIndex = 0;
    while ((match = wikiPattern.exec(entry.text))) {
      links.push({ type: "wiki", target: match[1], line: entry.line, column: match.index });
    }
  }

  links.sort(
    (left, right) =>
      left.line - right.line || left.column - right.column || compareText(left.type, right.type)
  );
  return links;
}

function unwrapLinkTarget(value) {
  const trimmed = value.trim();
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1)
    : trimmed;
  return unwrapped.replace(/\\ /gu, " ");
}

function decodeLinkPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripQueryAndFragment(value) {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const indexes = [query, fragment].filter((index) => index >= 0);
  return indexes.length === 0 ? value : value.slice(0, Math.min(...indexes));
}

function isNonRelativeLink(target) {
  return (
    target === "" ||
    target.startsWith("#") ||
    target.startsWith("?") ||
    target.startsWith("/") ||
    target.startsWith("//") ||
    target.startsWith("~") ||
    /^[a-z][a-z\d+.-]*:/iu.test(target) ||
    path.win32.isAbsolute(target)
  );
}

async function physicalTarget(root, target, cache) {
  if (!cache.has(target)) {
    cache.set(target, (async () => {
      try {
        const resolved = await realpath(target);
        return insideRoot(root, resolved)
          ? { ok: true }
          : { ok: false, outside: true };
      } catch (error) {
        if (["ENOENT", "ENOTDIR", "ELOOP"].includes(error?.code)) return { ok: false };
        return { ok: false, unreadable: true, reason: error?.code ?? error?.name ?? "UNKNOWN" };
      }
    })());
  }
  return cache.get(target);
}

async function checkMarkdownTarget(root, sourceAbsolute, rawTarget, existenceCache) {
  const target = unwrapLinkTarget(rawTarget);
  if (isNonRelativeLink(target)) return { ok: true };
  const encodedFilePart = stripQueryAndFragment(target);
  if (encodedFilePart === "") return { ok: true };
  const filePart = decodeLinkPath(encodedFilePart);
  const absolute = path.resolve(path.dirname(sourceAbsolute), filePart);
  if (!insideRoot(root, absolute)) return { ok: false, outside: true, target };
  return { ...(await physicalTarget(root, absolute, existenceCache)), target };
}

function wikiPage(rawTarget) {
  const withoutAlias = rawTarget.split("|", 1)[0].trim();
  const withoutHeading = withoutAlias.split("#", 1)[0].split("^", 1)[0].trim();
  return decodeLinkPath(unwrapLinkTarget(withoutHeading));
}

async function checkWikiTarget(
  root,
  sourceAbsolute,
  rawTarget,
  knownPaths,
  existenceCache
) {
  const page = wikiPage(rawTarget);
  if (page === "") return { ok: true };

  const hasKnownExtension = /\.(?:md|markdown|canvas|pdf|png|jpe?g|gif|svg|webp)$/iu.test(page);
  const variants = hasKnownExtension ? [page] : [`${page}.md`, page];
  const candidates = [];
  for (const variant of variants) {
    candidates.push(path.resolve(path.dirname(sourceAbsolute), variant));
    candidates.push(path.resolve(root, variant));
    candidates.push(path.resolve(root, CONTEXT_DIRECTORY, variant));
  }

  let inaccessible;
  for (const candidate of candidates) {
    if (!insideRoot(root, candidate)) continue;
    const outcome = await physicalTarget(root, candidate, existenceCache);
    if (outcome.ok) return { ok: true };
    if (outcome.unreadable || outcome.outside) inaccessible ??= outcome;
  }

  const expectedBasenames = new Set(variants.map((variant) => path.basename(variant)));
  const basenameMatches = knownPaths.filter((relative) => expectedBasenames.has(path.basename(relative)));
  if (basenameMatches.length === 1) {
    const candidate = managedPath(root, basenameMatches[0]);
    const outcome = await physicalTarget(root, candidate, existenceCache);
    if (outcome.ok) return { ok: true };
    if (outcome.unreadable || outcome.outside) inaccessible ??= outcome;
  }

  return { ok: false, target: rawTarget.trim(), ...inaccessible };
}

async function inspectLinks(root, canonical, knownPaths, recorder) {
  const existenceCache = new Map();

  for (const [relative, note] of [...canonical.entries()].sort(([left], [right]) => compareText(left, right))) {
    const sourceAbsolute = managedPath(root, relative);
    for (const link of extractLinks(note.content)) {
      const outcome = link.type === "wiki"
        ? await checkWikiTarget(root, sourceAbsolute, link.target, knownPaths, existenceCache)
        : await checkMarkdownTarget(root, sourceAbsolute, link.target, existenceCache);
      if (outcome.ok) continue;

      recorder.error("links", {
        code: outcome.outside ? "RELATIVE_LINK_OUTSIDE_ROOT" : outcome.unreadable
          ? "UNREADABLE_LINK_TARGET" : link.type === "wiki"
          ? "BROKEN_WIKILINK"
          : "BROKEN_MARKDOWN_LINK",
        file: relative,
        line: link.line,
        target: outcome.target,
        message: outcome.outside
          ? "El enlace relativo sale del repositorio."
          : outcome.unreadable
            ? "No se pudo comprobar el destino del enlace."
          : link.type === "wiki"
            ? "El wikilink no tiene un destino existente."
            : "El enlace Markdown relativo no tiene un destino existente."
      });
    }
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function duplicateSource(content) {
  let value = content;
  if (value.startsWith("---")) value = value.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u, "");
  const generatedPattern = new RegExp(
    `${escapeRegularExpression(START_MARKER)}[\\s\\S]*?${escapeRegularExpression(END_MARKER)}`,
    "gu"
  );
  return value
    .replace(generatedPattern, "")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/gu, "")
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/!?\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu, "$1");
}

function normalizeWords(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("es")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function duplicateProfile(content) {
  const source = duplicateSource(content);
  const paragraphs = source
    .split(/(?:\r?\n){2,}/u)
    .map(normalizeWords)
    .filter((paragraph) => paragraph.length >= 100 && paragraph.split(" ").length >= 12);
  const normalized = normalizeWords(source);
  const tokens = normalized === "" ? [] : normalized.split(" ");
  const shingles = new Set();
  for (let index = 0; index <= tokens.length - 7; index += 1) {
    shingles.add(tokens.slice(index, index + 7).join(" "));
  }
  return { paragraphs: new Set(paragraphs), tokens, shingles };
}

function intersectionSize(left, right) {
  let count = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = smaller === left ? right : left;
  for (const value of smaller) if (larger.has(value)) count += 1;
  return count;
}

function inspectDuplicates(canonical, recorder) {
  const notes = [...canonical.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([relative, note]) => [relative, duplicateProfile(note.content)]);

  for (let leftIndex = 0; leftIndex < notes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < notes.length; rightIndex += 1) {
      const [leftFile, left] = notes[leftIndex];
      const [rightFile, right] = notes[rightIndex];
      const sharedParagraphs = [...left.paragraphs]
        .filter((paragraph) => right.paragraphs.has(paragraph))
        .sort((first, second) => second.length - first.length || compareText(first, second));

      const sharedShingles = intersectionSize(left.shingles, right.shingles);
      const smallestShingleSet = Math.min(left.shingles.size, right.shingles.size);
      const containment = smallestShingleSet === 0 ? 0 : sharedShingles / smallestShingleSet;
      const paragraphDuplicate = sharedParagraphs.length > 0;
      const broadDuplicate = sharedShingles >= 10 && containment >= 0.6;
      if (!paragraphDuplicate && !broadDuplicate) continue;

      recorder.warning("duplicates", {
        code: "SIGNIFICANT_DUPLICATE",
        file: leftFile,
        relatedFile: rightFile,
        message: "Las notas repiten contenido significativo que debería tener una sola fuente.",
        similarity: Number(containment.toFixed(3)),
        sharedWords: paragraphDuplicate ? sharedParagraphs[0].split(" ").length : undefined
      });
    }
  }
}

function isPlaceholder(value) {
  const normalized = value
    .trim()
    .replace(/^["'`]|["'`,;]$/gu, "")
    .trim()
    .toLocaleLowerCase("en");
  if (normalized === "") return true;
  if (/^<[^>]+>$|^\$\{[^}]+\}$|^\{\{[^}]+\}\}$/u.test(normalized)) return true;
  if (/^(?:process\.env\.|env\.)[a-z_][a-z\d_]*$/iu.test(normalized)) return true;
  return /^(?:change-?me|replace-?me|placeholder|your[-_].*|example(?:[-_].*)?|dummy|sample|test(?:ing)?|redacted|masked|none|null|undefined|pending|pendiente|x{3,}|\*{3,}|0{4,}|\.\.\.)$/u.test(normalized);
}

function lineOf(content, offset) {
  return content.slice(0, offset).split(/\r\n|\r|\n/).length;
}

function placeholderEmail(address) {
  const [local = "", domain = ""] = address.toLocaleLowerCase("en").split("@");
  return (
    /^(?:example\.(?:com|org|net)|example|invalid|localhost|.*\.example\.com)$/u.test(domain) ||
    /^(?:user(?:name)?|name|email|correo|test|your(?:\.?name)?|noreply|placeholder)$/u.test(local)
  );
}

function placeholderPhone(value) {
  const digits = value.replace(/\D/gu, "");
  return (
    digits.length < 10 ||
    digits.length > 15 ||
    /^(\d)\1+$/u.test(digits) ||
    /^(?:0123456789|1234567890|5555555555)$/u.test(digits) ||
    /55501\d{2}$/u.test(digits)
  );
}

function inspectSensitiveData(canonical, recorder) {
  const privateKeyPattern = /-----BEGIN(?:(?: [A-Z0-9]+)* PRIVATE KEY| PGP PRIVATE KEY BLOCK)-----/gu;
  const knownTokenPatterns = [
    /\bgh[pousr]_[A-Za-z\d]{20,}\b/gu,
    /\bgithub_pat_[A-Za-z\d_]{20,}\b/gu,
    /\bnpm_[A-Za-z\d]{20,}\b/gu,
    /\bsk-(?:proj-)?[A-Za-z\d_-]{20,}\b/gu,
    /\bAKIA[A-Z\d]{16}\b/gu,
    /\bAIza[A-Za-z\d_-]{30,}\b/gu,
    /\bxox[baprs]-[A-Za-z\d-]{16,}\b/gu,
    /\beyJ[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\.[A-Za-z\d_-]{10,}\b/gu,
    /\bBearer\s+[A-Za-z\d._~+/=-]{16,}\b/giu
  ];
  const assignmentPattern = /(?:^|[\s{,;"'`])((?:[a-z\d]+[-_])*(?:password|passwd|pwd|client[-_]?secret|api[-_]?key|access[-_]?key|access[-_]?token|auth[-_]?token|refresh[-_]?token|secret[-_]?access[-_]?key|secret[-_]?key|private[-_]?key|token))\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s,;#]+))/giu;
  const urlCredentialPattern = /\b[a-z][a-z\d+.-]*:\/\/[^\s/:@]+:([^\s/@]+)@/giu;
  const emailPattern = /\b[A-Z\d._%+-]+@[A-Z\d.-]+\.[A-Z]{2,63}\b/giu;
  const internationalPhonePattern = /(?<![\p{L}\p{N}])\+\d[\d\s().-]{8,}\d(?![\p{L}\p{N}])/gu;
  const formattedPhonePattern = /(?<![\p{L}\p{N}])(?:\(\d{2,4}\)|\d{2,3})[\s.-]\d{3,4}[\s.-]\d{4}(?![\p{L}\p{N}])/gu;
  const labelledPhonePattern = /\b(?:tel(?:[ée]fono)?|phone|mobile|m[oó]vil|cel(?:ular)?)\s*[:=]\s*(\+?[\d\s().-]{8,}\d)/giu;

  for (const [relative, note] of [...canonical.entries()].sort(([left], [right]) => compareText(left, right))) {
    const content = note.content;
    const sensitiveLines = new Set();

    privateKeyPattern.lastIndex = 0;
    let match;
    while ((match = privateKeyPattern.exec(content))) {
      const line = lineOf(content, match.index);
      sensitiveLines.add(line);
      recorder.error("sensitive-data", {
        code: "PRIVATE_KEY",
        file: relative,
        line,
        message: "Se detectó material de llave privada en el contexto."
      });
    }

    const lines = content.split(/\r\n|\r|\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const lineNumber = index + 1;
      const rawLine = lines[index];
      const assignmentLine = rawLine.replace(/[*]/gu, "");

      assignmentPattern.lastIndex = 0;
      while ((match = assignmentPattern.exec(assignmentLine))) {
        const key = match[1].toLocaleLowerCase("en");
        const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? "";
        if (isPlaceholder(value) || sensitiveLines.has(lineNumber)) continue;
        sensitiveLines.add(lineNumber);
        recorder.error("sensitive-data", {
          code: key.includes("token") || key.includes("api") ? "EXPOSED_TOKEN" : "EXPOSED_CREDENTIAL",
          file: relative,
          line: lineNumber,
          message: "Se detectó una credencial o token con valor material en el contexto."
        });
      }

      for (const pattern of knownTokenPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(rawLine) && !sensitiveLines.has(lineNumber)) {
          sensitiveLines.add(lineNumber);
          recorder.error("sensitive-data", {
            code: "EXPOSED_TOKEN",
            file: relative,
            line: lineNumber,
            message: "Se detectó un token con formato reconocible en el contexto."
          });
        }
      }

      urlCredentialPattern.lastIndex = 0;
      while ((match = urlCredentialPattern.exec(rawLine))) {
        if (isPlaceholder(match[1]) || sensitiveLines.has(lineNumber)) continue;
        sensitiveLines.add(lineNumber);
        recorder.error("sensitive-data", {
          code: "EXPOSED_CREDENTIAL",
          file: relative,
          line: lineNumber,
          message: "Se detectaron credenciales incrustadas en una URL."
        });
      }

      emailPattern.lastIndex = 0;
      while ((match = emailPattern.exec(rawLine))) {
        if (placeholderEmail(match[0])) continue;
        recorder.warning("sensitive-data", {
          code: "PERSONAL_EMAIL",
          file: relative,
          line: lineNumber,
          message: "Se detectó una dirección de correo posiblemente personal."
        });
      }

      const phoneCandidates = [];
      for (const pattern of [internationalPhonePattern, formattedPhonePattern]) {
        pattern.lastIndex = 0;
        while ((match = pattern.exec(rawLine))) phoneCandidates.push(match[0]);
      }
      labelledPhonePattern.lastIndex = 0;
      while ((match = labelledPhonePattern.exec(rawLine))) phoneCandidates.push(match[1]);
      if (phoneCandidates.some((candidate) => !placeholderPhone(candidate))) {
        recorder.warning("sensitive-data", {
          code: "PERSONAL_PHONE",
          file: relative,
          line: lineNumber,
          message: "Se detectó un número telefónico posiblemente personal."
        });
      }
    }
  }
}

/**
 * Audita el contrato mínimo de Project Brain sin escribir archivos ni terminar el proceso.
 *
 * @param {string} inputRoot Directorio del repositorio que se debe revisar.
 * @returns {Promise<{ok: boolean, errors: object[], warnings: object[], checks: object[]}>}
 */
export async function doctor(inputRoot = ".") {
  const recorder = createRecorder();
  let root;
  try {
    root = await resolveRoot(inputRoot);
  } catch (error) {
    recorder.error("canonical-files", {
      code: "INVALID_ROOT",
      file: ".",
      message: "No se pudo abrir el directorio solicitado.",
      reason: error?.code ?? error?.name ?? "UNKNOWN"
    });
    return recorder.result();
  }

  const canonical = new Map();
  const contextPath = managedPath(root, CONTEXT_DIRECTORY);
  let contextDirectorySafe = false;
  let contextInfo;
  try {
    contextInfo = await lstatIfPresent(contextPath);
  } catch (error) {
    recorder.error("canonical-files", {
      code: "UNREADABLE_CONTEXT_DIRECTORY",
      file: CONTEXT_DIRECTORY,
      message: "No se pudo inspeccionar el directorio de contexto.",
      reason: error?.code ?? error?.name ?? "UNKNOWN"
    });
  }
  if (contextInfo?.isSymbolicLink()) {
    recorder.error("canonical-files", {
      code: "SYMLINK_CONTEXT_DIRECTORY",
      file: CONTEXT_DIRECTORY,
      message: "El directorio de contexto no puede ser un enlace simbólico."
    });
  } else if (contextInfo && !contextInfo.isDirectory()) {
    recorder.error("canonical-files", {
      code: "INVALID_CONTEXT_DIRECTORY",
      file: CONTEXT_DIRECTORY,
      message: "La ruta de contexto existe, pero no es un directorio."
    });
  } else if (contextInfo?.isDirectory()) {
    contextDirectorySafe = true;
  }

  for (const relative of REQUIRED_FILES) {
    if (relative.startsWith(`${CONTEXT_DIRECTORY}/`) && contextInfo?.isSymbolicLink()) continue;
    const absolute = managedPath(root, relative);
    let info;
    try {
      info = await lstatIfPresent(absolute);
    } catch (error) {
      recorder.error("canonical-files", {
        code: "UNREADABLE_CANONICAL_FILE",
        file: relative,
        message: "No se pudo inspeccionar el archivo canónico.",
        reason: error?.code ?? error?.name ?? "UNKNOWN"
      });
      continue;
    }

    if (!info) {
      recorder.error("canonical-files", {
        code: "MISSING_CANONICAL_FILE",
        file: relative,
        message: "Falta un archivo canónico del contrato."
      });
      continue;
    }
    if (info.isSymbolicLink()) {
      recorder.error("canonical-files", {
        code: "SYMLINK_CANONICAL_FILE",
        file: relative,
        message: "Un archivo canónico no puede ser un enlace simbólico."
      });
      continue;
    }
    if (!info.isFile()) {
      recorder.error("canonical-files", {
        code: "INVALID_CANONICAL_FILE",
        file: relative,
        message: "La ruta canónica existe, pero no es un archivo regular."
      });
      continue;
    }

    if (info.size > MAX_AUDIT_FILE_BYTES) {
      recorder.error("size-limits", {
        code: "CONTENT_TOO_LARGE_TO_AUDIT",
        file: relative,
        message: "El archivo es demasiado grande para auditarlo de forma segura.",
        actual: info.size,
        limit: MAX_AUDIT_FILE_BYTES
      });
      canonical.set(relative, { content: "", bytes: info.size, lines: 0 });
      continue;
    }

    try {
      const content = relative === GENERATED_FILE
        ? await readText(absolute)
        : await readFile(absolute, "utf8");
      canonical.set(relative, {
        content,
        bytes: info.size,
        lines: lineCount(content)
      });
    } catch (error) {
      recorder.error("canonical-files", {
        code: "UNREADABLE_CANONICAL_FILE",
        file: relative,
        message: "No se pudo leer el archivo canónico como UTF-8.",
        reason: error?.code ?? error?.name ?? "UNKNOWN"
      });
    }
  }

  const generated = canonical.get(GENERATED_FILE);
  let generatedMarkersValid = false;
  if (generated) {
    const startCount = countOccurrences(generated.content, START_MARKER);
    const endCount = countOccurrences(generated.content, END_MARKER);
    if (startCount !== 1) {
      recorder.error("generated-markers", {
        code: "GENERATED_START_MARKER_COUNT",
        file: GENERATED_FILE,
        message: "El marcador inicial generado debe aparecer exactamente una vez.",
        actual: startCount,
        expected: 1
      });
    }
    if (endCount !== 1) {
      recorder.error("generated-markers", {
        code: "GENERATED_END_MARKER_COUNT",
        file: GENERATED_FILE,
        message: "El marcador final generado debe aparecer exactamente una vez.",
        actual: endCount,
        expected: 1
      });
    }
    const markersOrdered =
      generated.content.indexOf(START_MARKER) < generated.content.indexOf(END_MARKER);
    if (
      startCount === 1 &&
      endCount === 1 &&
      !markersOrdered
    ) {
      recorder.error("generated-markers", {
        code: "GENERATED_MARKER_ORDER",
        file: GENERATED_FILE,
        message: "El marcador final aparece antes del marcador inicial."
      });
    }
    generatedMarkersValid = startCount === 1 && endCount === 1 && markersOrdered;
  }

  inspectArtifactRoles(canonical, recorder);

  if (generated && generatedMarkersValid) {
    const expected = replaceGeneratedBlock(generated.content, await scanRepository(root));
    if (expected !== generated.content) {
      recorder.warning("generated-freshness", {
        code: "STALE_GENERATED_PROJECTION",
        file: GENERATED_FILE,
        message: "La proyección generada no coincide con el estado observable del repositorio."
      });
    }
  }

  let totalBytes = 0;
  for (const relative of REQUIRED_FILES) {
    const note = canonical.get(relative);
    if (!note) continue;
    totalBytes += note.bytes;
    if (note.bytes > LIMITS.bytesPerFile) {
      recorder.warning("size-limits", {
        code: "FILE_BYTES_EXCEEDED",
        file: relative,
        message: "El archivo supera el límite de bytes del contrato.",
        actual: note.bytes,
        limit: LIMITS.bytesPerFile
      });
    }
    if (note.lines > LIMITS.linesPerFile) {
      recorder.warning("size-limits", {
        code: "FILE_LINES_EXCEEDED",
        file: relative,
        message: "El archivo supera el límite de líneas del contrato.",
        actual: note.lines,
        limit: LIMITS.linesPerFile
      });
    }
  }
  if (totalBytes > LIMITS.totalBytes) {
    recorder.warning("size-limits", {
      code: "TOTAL_BYTES_EXCEEDED",
      file: CONTEXT_DIRECTORY,
      message: "El conjunto canónico supera el límite total de bytes.",
      actual: totalBytes,
      limit: LIMITS.totalBytes
    });
  }

  let contextEntries = [];
  if (contextDirectorySafe) {
    contextEntries = await collectExtraContextFiles(root, contextPath, recorder);
    for (const relative of contextEntries) {
      if (REQUIRED_CONTEXT_FILES.has(relative)) continue;
      recorder.warning("extra-context-files", {
        code: "EXTRA_CONTEXT_FILE",
        file: relative,
        message: "El archivo no forma parte del contrato mínimo de AI_CONTEXT."
      });
    }
  }

  const knownPaths = [...new Set([...canonical.keys(), ...contextEntries])].sort(compareText);
  const auditedNotes = new Map(canonical);
  for (const relative of contextEntries) {
    if (REQUIRED_CONTEXT_FILES.has(relative)) continue;
    const absolute = managedPath(root, relative);
    let info;
    try {
      info = await lstatIfPresent(absolute);
    } catch (error) {
      recorder.warning("extra-context-files", {
        code: "UNREADABLE_EXTRA_CONTEXT_FILE",
        file: relative,
        message: "No se pudo inspeccionar el archivo extra.",
        reason: error?.code ?? error?.name ?? "UNKNOWN"
      });
      continue;
    }
    if (!info?.isFile() || info.isSymbolicLink()) continue;
    if (!AUDITABLE_EXTRA_NAMES.test(path.posix.basename(relative))) continue;
    if (info.size > MAX_AUDIT_FILE_BYTES) {
      recorder.error("sensitive-data", {
        code: "CONTENT_TOO_LARGE_TO_AUDIT",
        file: relative,
        message: "El archivo extra es demasiado grande para descartar datos sensibles de forma segura.",
        actual: info.size,
        limit: MAX_AUDIT_FILE_BYTES
      });
      continue;
    }
    try {
      auditedNotes.set(relative, { content: await readFile(absolute, "utf8") });
    } catch (error) {
      recorder.warning("extra-context-files", {
        code: "UNREADABLE_EXTRA_CONTEXT_FILE",
        file: relative,
        message: "No se pudo auditar el contenido del archivo extra.",
        reason: error?.code ?? error?.name ?? "UNKNOWN"
      });
    }
  }

  await inspectLinks(root, auditedNotes, knownPaths, recorder);
  inspectDuplicates(auditedNotes, recorder);
  inspectSensitiveData(auditedNotes, recorder);
  inspectIntegrationReferences(auditedNotes, recorder);

  return recorder.result();
}

export const runDoctor = doctor;
export const doctorRepository = doctor;
export default doctor;
