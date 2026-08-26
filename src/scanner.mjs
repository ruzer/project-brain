import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { insideRoot, resolveRoot } from "./fs.mjs";

const execFileAsync = promisify(execFile);
const MAX_SEMANTIC_FILE_BYTES = 1024 * 1024;

const ALWAYS_IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "brain",
  ".brain",
  "graphify-out",
  ".graphify",
  ".obsidian",
  "ai_context",
  ".cache",
  "cache",
  "caches",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
  ".turbo",
  ".vite",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".angular",
  ".parcel-cache",
  ".pnpm-store",
  ".dart_tool",
  ".gradle",
  ".build",
  "deriveddata",
  "target"
]);

const ALWAYS_IGNORED_FILES = new Set([
  ".ds_store",
  ".eslintcache",
  ".stylelintcache"
]);

const LANGUAGE_BY_EXTENSION = new Map([
  [".bash", "Shell"],
  [".c", "C"],
  [".cc", "C++"],
  [".cjs", "JavaScript"],
  [".cpp", "C++"],
  [".cs", "C#"],
  [".css", "CSS"],
  [".cts", "TypeScript"],
  [".dart", "Dart"],
  [".go", "Go"],
  [".h", "C/C++"],
  [".hpp", "C++"],
  [".html", "HTML"],
  [".java", "Java"],
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".kt", "Kotlin"],
  [".kts", "Kotlin"],
  [".mjs", "JavaScript"],
  [".mts", "TypeScript"],
  [".php", "PHP"],
  [".py", "Python"],
  [".rb", "Ruby"],
  [".rs", "Rust"],
  [".sh", "Shell"],
  [".sql", "SQL"],
  [".swift", "Swift"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".vue", "Vue"],
  [".zsh", "Shell"]
]);

const MANIFEST_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "cargo.toml",
  "composer.json",
  "composer.lock",
  "docker-compose.yml",
  "docker-compose.yaml",
  "gemfile",
  "gemfile.lock",
  "go.mod",
  "go.sum",
  "gradle.properties",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "package.json",
  "package.swift",
  "pipfile",
  "pipfile.lock",
  "pnpm-lock.yaml",
  "poetry.lock",
  "pom.xml",
  "pubspec.lock",
  "pubspec.yaml",
  "pyproject.toml",
  "pytest.ini",
  "requirements.txt",
  "setup.cfg",
  "setup.py",
  "settings.gradle",
  "settings.gradle.kts",
  "tox.ini",
  "yarn.lock"
]);

const STACK_ORDER = [
  "Node.js",
  "TypeScript",
  "React",
  "Next.js",
  "Vite",
  "Express",
  "Flutter",
  "Python",
  "Go",
  "Rust",
  "Gradle",
  "Kotlin",
  "Java",
  "Swift",
  "Docker"
];

const VALIDATION_SCRIPT_PRIORITY = [
  "check",
  "verify",
  "validate",
  "lint",
  "typecheck",
  "type-check",
  "check:types",
  "test",
  "build",
  "format:check",
  "check:format",
  "audit"
];

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function normalizeRelativePath(relativePath) {
  const normalized = path.posix.normalize(toPosix(relativePath)).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return undefined;
  }
  return normalized;
}

function isIgnoredPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return true;

  const segments = normalized.split("/");
  if (segments.some((segment) => ALWAYS_IGNORED_DIRECTORIES.has(segment.toLowerCase()))) return true;

  const basename = segments.at(-1)?.toLowerCase() ?? "";
  return (
    ALWAYS_IGNORED_FILES.has(basename) ||
    basename.endsWith(".pyc") ||
    basename.endsWith(".pyo") ||
    basename.endsWith(".cache")
  );
}

async function listWithGit(root) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "-c", "core.fsmonitor=false", "ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
    );

    return stdout
      .toString("utf8")
      .split("\0")
      .map(normalizeRelativePath)
      .filter(Boolean);
  } catch {
    return undefined;
  }
}

async function walkLocal(root) {
  const files = [];

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => lexicalCompare(left.name, right.name));

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (isIgnoredPath(relativePath) || entry.isSymbolicLink()) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  }

  await visit(root, "");
  return files;
}

async function collectRecords(root) {
  const candidates = (await listWithGit(root)) ?? (await walkLocal(root));
  const uniquePaths = [...new Set(candidates.filter((filePath) => !isIgnoredPath(filePath)))].sort(lexicalCompare);
  const records = [];

  for (const relativePath of uniquePaths) {
    const absolutePath = path.join(root, ...relativePath.split("/"));
    try {
      const info = await lstat(absolutePath);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      const physicalPath = await realpath(absolutePath);
      if (!insideRoot(root, physicalPath)) continue;
      records.push({ path: relativePath, size: info.size });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  return records;
}

function extensionFor(filePath) {
  return path.posix.extname(filePath).toLowerCase() || "(none)";
}

function buildExtensions(records) {
  const counts = new Map();
  for (const record of records) {
    const extension = extensionFor(record.path);
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }

  return Object.fromEntries([...counts].sort(([left], [right]) => lexicalCompare(left, right)));
}

function buildLanguages(records) {
  const languages = new Set();
  for (const record of records) {
    const language = LANGUAGE_BY_EXTENSION.get(extensionFor(record.path));
    if (language) languages.add(language);
  }
  return [...languages].sort(lexicalCompare);
}

function isManifest(filePath) {
  const basename = path.posix.basename(filePath).toLowerCase();
  return (
    MANIFEST_NAMES.has(basename) ||
    /^dockerfile(?:\..+)?$/.test(basename) ||
    /^(?:compose|docker-compose)(?:\.[^.]+)?\.ya?ml$/.test(basename) ||
    /^requirements(?:[-_.][^/]*)?\.txt$/.test(basename) ||
    /^tsconfig(?:\.[^/]*)?\.json$/.test(basename) ||
    /^build\.gradle(?:\.kts)?$/.test(basename)
  );
}

function buildRoots(records) {
  const roots = new Set();
  for (const record of records) {
    const separator = record.path.indexOf("/");
    if (separator > 0) roots.add(record.path.slice(0, separator));
  }
  return [...roots].sort(lexicalCompare);
}

function buildFingerprint(records) {
  const input = records.map((record) => `${record.path}:${record.size}`).join("\n");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

async function readRecord(root, relativePath) {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  const lexicalInfo = await lstat(absolutePath);
  if (!lexicalInfo.isFile() || lexicalInfo.isSymbolicLink()) throw new Error("Manifest no regular.");
  const physicalPath = await realpath(absolutePath);
  if (!insideRoot(root, physicalPath)) throw new Error("Manifest fuera del repositorio.");
  const info = await lstat(physicalPath);
  if (info.size > MAX_SEMANTIC_FILE_BYTES) throw new Error("Manifest demasiado grande para análisis semántico.");
  return readFile(physicalPath, "utf8");
}

async function readPackageManifests(root, manifests) {
  const packages = [];
  for (const manifest of manifests.filter((filePath) => path.posix.basename(filePath).toLowerCase() === "package.json")) {
    try {
      const parsed = JSON.parse(await readRecord(root, manifest));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        packages.push({ path: manifest, value: parsed });
      }
    } catch {
      // El manifest sigue siendo evidencia de Node, aunque no sea JSON válido.
    }
  }
  return packages;
}

function packageDependencyNames(packages) {
  const names = new Set();
  for (const { value } of packages) {
    for (const group of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const dependencies = value[group];
      if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) continue;
      for (const name of Object.keys(dependencies)) names.add(name.toLowerCase());
    }
  }
  return names;
}

async function detectStack(root, records, manifests, packages, languages) {
  const basenames = new Set(records.map((record) => path.posix.basename(record.path).toLowerCase()));
  const manifestBasenames = new Set(manifests.map((filePath) => path.posix.basename(filePath).toLowerCase()));
  const dependencies = packageDependencyNames(packages);
  const detected = new Set();

  if (manifestBasenames.has("package.json") || [...manifestBasenames].some((name) => ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"].includes(name))) {
    detected.add("Node.js");
  }
  if (languages.includes("TypeScript") || [...manifestBasenames].some((name) => /^tsconfig(?:\..+)?\.json$/.test(name))) detected.add("TypeScript");
  if (dependencies.has("react") || dependencies.has("react-dom") || dependencies.has("next")) detected.add("React");
  if (dependencies.has("next") || [...basenames].some((name) => /^next\.config\./.test(name))) detected.add("Next.js");
  if (dependencies.has("vite") || [...basenames].some((name) => /^vite\.config\./.test(name))) detected.add("Vite");
  if (dependencies.has("express")) detected.add("Express");

  const pubspecs = manifests.filter((filePath) => path.posix.basename(filePath).toLowerCase() === "pubspec.yaml");
  for (const pubspec of pubspecs) {
    const content = await readRecord(root, pubspec).catch(() => "");
    if (/\bsdk\s*:\s*flutter\b/i.test(content) || /^\s*flutter\s*:/m.test(content)) detected.add("Flutter");
  }

  if (languages.includes("Python") || [...manifestBasenames].some((name) => ["pyproject.toml", "pipfile", "setup.py", "setup.cfg"].includes(name) || /^requirements.*\.txt$/.test(name))) detected.add("Python");
  if (languages.includes("Go") || manifestBasenames.has("go.mod")) detected.add("Go");
  if (languages.includes("Rust") || manifestBasenames.has("cargo.toml")) detected.add("Rust");
  if ([...manifestBasenames].some((name) => /^build\.gradle(?:\.kts)?$/.test(name) || /^settings\.gradle(?:\.kts)?$/.test(name))) detected.add("Gradle");
  if (languages.includes("Kotlin")) detected.add("Kotlin");
  if (languages.includes("Java")) detected.add("Java");
  if (languages.includes("Swift") || manifestBasenames.has("package.swift")) detected.add("Swift");
  if ([...manifestBasenames].some((name) => /^dockerfile(?:\..+)?$/.test(name) || /^(?:compose|docker-compose)(?:\.[^.]+)?\.ya?ml$/.test(name))) detected.add("Docker");

  return STACK_ORDER.filter((name) => detected.has(name));
}

function directoryOf(filePath) {
  const directory = path.posix.dirname(filePath);
  return directory === "." ? "" : directory;
}

function pathInDirectory(directory, child) {
  return directory ? `${directory}/${child}` : child;
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function commandInDirectory(directory, command) {
  return directory ? `cd ${shellQuote(directory)} && ${command}` : command;
}

function findNearestPackageManager(directory, filePaths) {
  let current = directory;
  for (;;) {
    if (filePaths.has(pathInDirectory(current, "pnpm-lock.yaml"))) return "pnpm";
    if (filePaths.has(pathInDirectory(current, "yarn.lock"))) return "yarn";
    if (filePaths.has(pathInDirectory(current, "bun.lock")) || filePaths.has(pathInDirectory(current, "bun.lockb"))) return "bun";
    if (filePaths.has(pathInDirectory(current, "package-lock.json")) || filePaths.has(pathInDirectory(current, "npm-shrinkwrap.json"))) return "npm";
    if (!current) break;
    const parent = path.posix.dirname(current);
    current = parent === "." ? "" : parent;
  }
  return "npm";
}

function isValidationScript(name) {
  return /^(?:check|verify|validate|lint|typecheck|type-check|test|build|audit|security)(?::[A-Za-z0-9._-]+)?$/.test(name);
}

function validationScriptCompare(left, right) {
  const leftRank = VALIDATION_SCRIPT_PRIORITY.indexOf(left);
  const rightRank = VALIDATION_SCRIPT_PRIORITY.indexOf(right);
  if (leftRank >= 0 || rightRank >= 0) {
    if (leftRank < 0) return 1;
    if (rightRank < 0) return -1;
    if (leftRank !== rightRank) return leftRank - rightRank;
  }
  return lexicalCompare(left, right);
}

function hasFilesUnder(records, directory, predicate) {
  const prefix = directory ? `${directory}/` : "";
  return records.some((record) => record.path.startsWith(prefix) && predicate(record.path.slice(prefix.length)));
}

async function detectValidationCommands(root, records, manifests, packages) {
  const commands = [];
  const filePaths = new Set(records.map((record) => record.path));

  for (const { path: packagePath, value } of [...packages].sort((left, right) => lexicalCompare(left.path, right.path))) {
    const scripts = value.scripts;
    if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) continue;

    const directory = directoryOf(packagePath);
    const manager = findNearestPackageManager(directory, filePaths);
    const names = Object.keys(scripts).filter((name) => {
      const body = scripts[name];
      return (
        isValidationScript(name) &&
        typeof body === "string" &&
        body.trim().length > 0 &&
        !/no test specified/i.test(body)
      );
    }).sort(validationScriptCompare);

    for (const name of names) {
      commands.push(commandInDirectory(directory, `${manager} run ${name}`));
    }
  }

  const pubspecs = manifests.filter((filePath) => path.posix.basename(filePath).toLowerCase() === "pubspec.yaml");
  for (const pubspec of pubspecs) {
    const directory = directoryOf(pubspec);
    const content = await readRecord(root, pubspec).catch(() => "");
    if (!/\bsdk\s*:\s*flutter\b/i.test(content) && !/^\s*flutter\s*:/m.test(content)) continue;
    commands.push(commandInDirectory(directory, "flutter analyze"));
    if (hasFilesUnder(records, directory, (filePath) => /(?:^|\/)test\/.*_test\.dart$/.test(filePath) || /_test\.dart$/.test(filePath))) {
      commands.push(commandInDirectory(directory, "flutter test"));
    }
  }

  const pythonManifestPattern = /^(?:pyproject\.toml|requirements(?:[-_.].*)?\.txt|pipfile|setup\.cfg|tox\.ini|pytest\.ini)$/i;
  const pythonDirectories = [...new Set(manifests.filter((filePath) => pythonManifestPattern.test(path.posix.basename(filePath))).map(directoryOf))].sort(lexicalCompare);
  for (const directory of pythonDirectories) {
    const relevant = manifests.filter((filePath) => directoryOf(filePath) === directory && pythonManifestPattern.test(path.posix.basename(filePath)));
    const content = (await Promise.all(relevant.map((filePath) => readRecord(root, filePath).catch(() => "")))).join("\n").toLowerCase();
    if (content.includes("pytest")) commands.push(commandInDirectory(directory, "python -m pytest"));
    if (/\bruff\b/.test(content)) commands.push(commandInDirectory(directory, "ruff check ."));
    if (/\bmypy\b/.test(content)) commands.push(commandInDirectory(directory, "mypy ."));
  }

  for (const goMod of manifests.filter((filePath) => path.posix.basename(filePath).toLowerCase() === "go.mod")) {
    const directory = directoryOf(goMod);
    commands.push(commandInDirectory(directory, "go test ./..."));
    commands.push(commandInDirectory(directory, "go vet ./..."));
  }

  for (const cargoToml of manifests.filter((filePath) => path.posix.basename(filePath).toLowerCase() === "cargo.toml")) {
    const directory = directoryOf(cargoToml);
    commands.push(commandInDirectory(directory, "cargo check"));
    commands.push(commandInDirectory(directory, "cargo test"));
  }

  const gradleBuilds = manifests.filter((filePath) => /^build\.gradle(?:\.kts)?$/i.test(path.posix.basename(filePath)));
  for (const buildFile of gradleBuilds) {
    const directory = directoryOf(buildFile);
    if (!filePaths.has(pathInDirectory(directory, "gradlew"))) continue;
    const content = await readRecord(root, buildFile).catch(() => "");
    if (!/(?:\bjava\b|\bkotlin\b|com\.android)/i.test(content)) continue;
    commands.push(commandInDirectory(directory, "./gradlew check"));
    if (hasFilesUnder(records, directory, (filePath) => /(?:^|\/)src\/test\//.test(filePath))) {
      commands.push(commandInDirectory(directory, "./gradlew test"));
    }
  }

  for (const packageSwift of manifests.filter((filePath) => path.posix.basename(filePath).toLowerCase() === "package.swift")) {
    const directory = directoryOf(packageSwift);
    commands.push(commandInDirectory(directory, "swift build"));
    if (hasFilesUnder(records, directory, (filePath) => /(?:^|\/)tests\//i.test(filePath))) {
      commands.push(commandInDirectory(directory, "swift test"));
    }
  }

  for (const composeFile of manifests.filter((filePath) => /^(?:compose|docker-compose)(?:\.[^.]+)?\.ya?ml$/i.test(path.posix.basename(filePath)))) {
    const directory = directoryOf(composeFile);
    const basename = path.posix.basename(composeFile);
    const defaultName = /^(?:compose|docker-compose)\.ya?ml$/i.test(basename);
    commands.push(commandInDirectory(directory, defaultName ? "docker compose config" : `docker compose -f ${shellQuote(basename)} config`));
  }

  for (const dockerfile of manifests.filter((filePath) => /^dockerfile(?:\..+)?$/i.test(path.posix.basename(filePath)))) {
    const directory = directoryOf(dockerfile);
    const basename = path.posix.basename(dockerfile);
    commands.push(commandInDirectory(directory, `docker build -f ${shellQuote(basename)} .`));
  }

  return [...new Set(commands)];
}

export async function scanRepository(root = ".") {
  const resolvedRoot = await resolveRoot(root);
  const records = await collectRecords(resolvedRoot);
  const manifests = records.map((record) => record.path).filter(isManifest).sort(lexicalCompare);
  const languages = buildLanguages(records);
  const packages = await readPackageManifests(resolvedRoot, manifests);

  return {
    fileCount: records.length,
    fingerprint: buildFingerprint(records),
    roots: buildRoots(records),
    extensions: buildExtensions(records),
    languages,
    manifests,
    stack: await detectStack(resolvedRoot, records, manifests, packages, languages),
    validationCommands: await detectValidationCommands(resolvedRoot, records, manifests, packages)
  };
}
