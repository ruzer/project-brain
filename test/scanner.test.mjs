import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scanRepository } from "../src/scanner.mjs";

async function temporaryRepository(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "brain-scanner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function put(root, relativePath, content = "") {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

test("genera un inventario determinista y excluye artefactos, builds y cachés", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "package.json", JSON.stringify({
    scripts: {
      lint: "eslint .",
      test: "node --test",
      build: "tsc"
    },
    dependencies: {
      express: "1.0.0",
      next: "1.0.0",
      react: "1.0.0",
      vite: "1.0.0"
    }
  }));
  await put(root, "package-lock.json", "{}\n");
  await put(root, "tsconfig.json", "{}\n");
  await put(root, "src/app.tsx", "export const app = true;\n");
  await put(root, "test/app.test.ts", "export const test = true;\n");
  await put(root, "Dockerfile", "FROM scratch\n");
  await put(root, "compose.yaml", "services: {}\n");

  for (const ignored of [
    ".git/internal",
    "node_modules/pkg/index.js",
    "dist/app.js",
    "build/app.js",
    "coverage/result.json",
    "BRAIN/context.md",
    ".brain/state.json",
    "graphify-out/graph.json",
    ".graphify/cache.json",
    ".obsidian/workspace.json",
    "AI_CONTEXT/CONTEXT.md",
    ".cache/cache.bin",
    "src/__pycache__/module.pyc"
  ]) await put(root, ignored, "ignored");

  const first = await scanRepository(root);
  const second = await scanRepository(root);

  assert.deepEqual(second, first);
  assert.equal(first.fileCount, 7);
  assert.match(first.fingerprint, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.roots, ["src", "test"]);
  assert.deepEqual(first.extensions, {
    "(none)": 1,
    ".json": 3,
    ".ts": 1,
    ".tsx": 1,
    ".yaml": 1
  });
  assert.deepEqual(first.languages, ["TypeScript"]);
  assert.deepEqual(first.manifests, ["Dockerfile", "compose.yaml", "package-lock.json", "package.json", "tsconfig.json"]);
  assert.deepEqual(first.stack, ["Node.js", "TypeScript", "React", "Next.js", "Vite", "Express", "Docker"]);
  assert.deepEqual(first.validationCommands, [
    "npm run lint",
    "npm run test",
    "npm run build",
    "docker compose config",
    "docker build -f Dockerfile ."
  ]);

  await put(root, "BRAIN/new-output.md", "un cambio ignorado");
  assert.equal((await scanRepository(root)).fingerprint, first.fingerprint);
});

test("la huella usa rutas y tamaños, no timestamps ni contenido del mismo tamaño", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "src/value.js", "abc");
  const initial = await scanRepository(root);

  await put(root, "src/value.js", "xyz");
  const sameSize = await scanRepository(root);
  assert.equal(sameSize.fingerprint, initial.fingerprint);

  await put(root, "src/value.js", "longer");
  const differentSize = await scanRepository(root);
  assert.notEqual(differentSize.fingerprint, initial.fingerprint);
});

test("prefiere git ls-files y respeta exclusiones estándar", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git no está disponible");
    return;
  }

  const root = await temporaryRepository(t);
  execFileSync("git", ["init", "-q", root]);
  await put(root, ".gitignore", "ignored-by-git.txt\n");
  await put(root, "src/tracked.js", "tracked\n");
  await put(root, "src/untracked.js", "untracked\n");
  await put(root, "ignored-by-git.txt", "ignored\n");
  execFileSync("git", ["-C", root, "add", ".gitignore", "src/tracked.js"]);

  const scan = await scanRepository(root);
  assert.equal(scan.fileCount, 3);
  assert.deepEqual(scan.roots, ["src"]);

  await put(root, "ignored-by-git.txt", "ignored, incluso si cambia de tamaño\n");
  assert.equal((await scanRepository(root)).fingerprint, scan.fingerprint);
});

test("neutraliza hooks fsmonitor al consultar el inventario de Git", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git no está disponible");
    return;
  }

  const root = await temporaryRepository(t);
  const marker = path.join(root, "fsmonitor-ran");
  const hook = path.join(root, "fsmonitor-hook.sh");
  execFileSync("git", ["init", "-q", root]);
  await writeFile(hook, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`, "utf8");
  await chmod(hook, 0o755);
  execFileSync("git", ["-C", root, "config", "core.fsmonitor", "./fsmonitor-hook.sh"]);

  await scanRepository(root);
  await assert.rejects(() => access(marker), /ENOENT/);
});

test("descarta rutas Git que escapan mediante un directorio simbólico", async (t) => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("git no está disponible");
    return;
  }

  const root = await temporaryRepository(t);
  const outside = await temporaryRepository(t);
  execFileSync("git", ["init", "-q", root]);
  await put(root, "dir/package.json", "{}\n");
  execFileSync("git", ["-C", root, "add", "dir/package.json"]);
  await rm(path.join(root, "dir"), { recursive: true });
  await put(outside, "package.json", JSON.stringify({ dependencies: { express: "latest" } }));
  await symlink(outside, path.join(root, "dir"));

  const scan = await scanRepository(root);
  assert.equal(scan.manifests.includes("dir/package.json"), false);
  assert.equal(scan.stack.includes("Express"), false);
});

test("no carga semánticamente manifests desproporcionados", async (t) => {
  const root = await temporaryRepository(t);
  const padding = "x".repeat(1024 * 1024 + 1);
  await put(root, "package.json", JSON.stringify({ dependencies: { express: "latest" }, padding }));

  const scan = await scanRepository(root);
  assert.ok(scan.manifests.includes("package.json"));
  assert.deepEqual(scan.stack, ["Node.js"]);
});

test("detecta stacks y validaciones solo cuando hay evidencia real", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "flutter/pubspec.yaml", "dependencies:\n  flutter:\n    sdk: flutter\n");
  await put(root, "flutter/lib/main.dart", "void main() {}\n");
  await put(root, "flutter/test/widget_test.dart", "void main() {}\n");

  await put(root, "python/pyproject.toml", "[project]\ndependencies = ['pytest', 'ruff', 'mypy']\n");
  await put(root, "python/tests/test_app.py", "def test_app(): pass\n");

  await put(root, "go/go.mod", "module example.test/app\n");
  await put(root, "go/main.go", "package main\n");

  await put(root, "rust/Cargo.toml", "[package]\nname = 'app'\nversion = '0.1.0'\n");
  await put(root, "rust/src/lib.rs", "pub fn app() {}\n");

  await put(root, "gradle/build.gradle.kts", "plugins { kotlin(\"jvm\") version \"2.0.0\" }\n");
  await put(root, "gradle/gradlew", "#!/bin/sh\n");
  await put(root, "gradle/src/main/kotlin/App.kt", "class App\n");
  await put(root, "gradle/src/main/java/App.java", "class App {}\n");
  await put(root, "gradle/src/test/kotlin/AppTest.kt", "class AppTest\n");

  await put(root, "swift/Package.swift", "// swift-tools-version: 6.0\n");
  await put(root, "swift/Sources/App/main.swift", "print(\"ok\")\n");
  await put(root, "swift/Tests/AppTests/AppTests.swift", "// test\n");

  const scan = await scanRepository(root);
  assert.deepEqual(scan.stack, ["Flutter", "Python", "Go", "Rust", "Gradle", "Kotlin", "Java", "Swift"]);
  for (const command of [
    "cd flutter && flutter analyze",
    "cd flutter && flutter test",
    "cd python && python -m pytest",
    "cd python && ruff check .",
    "cd python && mypy .",
    "cd go && go test ./...",
    "cd go && go vet ./...",
    "cd rust && cargo check",
    "cd rust && cargo test",
    "cd gradle && ./gradlew check",
    "cd gradle && ./gradlew test",
    "cd swift && swift build",
    "cd swift && swift test"
  ]) assert.ok(scan.validationCommands.includes(command), `Falta comando detectado: ${command}`);
});

test("no inventa scripts de Node y omite enlaces simbólicos", async (t) => {
  const root = await temporaryRepository(t);
  await put(root, "package.json", JSON.stringify({
    scripts: {
      dev: "node app.js",
      test: "echo 'Error: no test specified' && exit 1"
    }
  }));
  await put(root, "app.js", "console.log('ok');\n");
  await put(root, "outside.txt", "outside\n");
  await symlink(path.join(root, "outside.txt"), path.join(root, "linked.txt"));

  const scan = await scanRepository(root);
  assert.deepEqual(scan.validationCommands, []);
  assert.equal(scan.fileCount, 3);
  assert.deepEqual(scan.stack, ["Node.js"]);
});
