import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { temporaryRepository } from "../test-support/helpers.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedFiles = [
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "bin/brain.mjs",
  "package.json",
  "schema/context-contract.schema.json",
  "src/cli.mjs",
  "src/context.mjs",
  "src/contract.mjs",
  "src/doctor.mjs",
  "src/fs.mjs",
  "src/index.mjs",
  "src/init.mjs",
  "src/scanner.mjs",
  "src/sync.mjs",
  "src/templates.mjs",
  "templates/AGENTS.md",
  "templates/AI_CONTEXT/CONTEXT.md",
  "templates/AI_CONTEXT/DECISIONS.md",
  "templates/AI_CONTEXT/LEARNINGS.md",
  "templates/AI_CONTEXT/TASKS.md"
].sort();

function execute(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
        ...options
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number" && !error.killed && !error.signal) {
          resolve({ exitCode: error.code, stdout, stderr });
          return;
        }
        reject(error);
      }
    );
  });
}

function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return execute(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  return execute(process.platform === "win32" ? "npm.cmd" : "npm", args, options);
}

async function gitStatus() {
  const result = await execute(
    "git",
    ["-C", packageRoot, "status", "--porcelain=v1", "-z", "--untracked-files=all"]
  );
  assert.equal(result.exitCode, 0);
  return result.stdout;
}

function parseJson(result) {
  assert.equal(result.exitCode, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), "");
  return JSON.parse(result.stdout);
}

test("el tarball funciona desde un consumidor temporal sin red ni residuos", async (t) => {
  const workspace = await temporaryRepository(t, "brain-package-");
  const artifacts = path.join(workspace, "artifacts");
  const cache = path.join(workspace, "empty-cache");
  const consumer = path.join(workspace, "consumer");
  const repository = path.join(workspace, "repository with spaces");
  await Promise.all([
    mkdir(artifacts),
    mkdir(cache),
    mkdir(consumer),
    mkdir(repository)
  ]);

  const statusBefore = await gitStatus();
  t.after(async () => {
    assert.equal(await gitStatus(), statusBefore, "npm pack o install modificó el checkout");
  });

  const packageJson = JSON.parse(
    await readFile(path.join(packageRoot, "package.json"), "utf8")
  );
  const npmEnvironment = {
    ...process.env,
    npm_config_audit: "false",
    npm_config_cache: cache,
    npm_config_dry_run: "false",
    npm_config_fund: "false",
    npm_config_ignore_scripts: "true",
    npm_config_offline: "true",
    npm_config_update_notifier: "false"
  };

  const packedResult = await runNpm(
    [
      "pack",
      "--json",
      "--dry-run=false",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      "--pack-destination",
      artifacts,
      "--cache",
      cache
    ],
    { cwd: packageRoot, env: npmEnvironment }
  );
  const packed = parseJson(packedResult);
  assert.equal(packed.length, 1);
  const manifest = packed[0];
  assert.equal(manifest.name, packageJson.name);
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.entryCount, expectedFiles.length);
  assert.deepEqual(manifest.files.map((file) => file.path).sort(), expectedFiles);
  assert.deepEqual(manifest.bundled, []);

  const tarball = path.join(artifacts, manifest.filename);
  await access(tarball);
  await writeFile(
    path.join(consumer, "package.json"),
    `${JSON.stringify({ name: "project-brain-package-consumer", private: true }, null, 2)}\n`,
    "utf8"
  );

  const installedResult = await runNpm(
    [
      "install",
      tarball,
      "--save-exact",
      "--ignore-scripts",
      "--offline",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      "--loglevel=error",
      "--cache",
      cache
    ],
    { cwd: consumer, env: npmEnvironment }
  );
  assert.equal(installedResult.exitCode, 0, installedResult.stderr);

  const installedRoot = path.join(consumer, "node_modules", "@ruzer", "project-brain");
  const installedPackage = JSON.parse(
    await readFile(path.join(installedRoot, "package.json"), "utf8")
  );
  for (const field of [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "bundledDependencies",
    "bundleDependencies"
  ]) {
    assert.equal(installedPackage[field], undefined, `dependencia inesperada: ${field}`);
  }
  await assert.rejects(access(path.join(installedRoot, "node_modules")), { code: "ENOENT" });

  const tree = parseJson(await runNpm(
    ["ls", "--all", "--json", "--offline", "--loglevel=error", "--cache", cache],
    { cwd: consumer, env: npmEnvironment }
  ));
  assert.deepEqual(Object.keys(tree.dependencies ?? {}), [packageJson.name]);
  assert.equal(tree.dependencies[packageJson.name].dependencies, undefined);

  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  const jsonImportAttribute = nodeMajor === 20 && nodeMinor < 10 ? "assert" : "with";
  const importScript = [
    `const api = await import(${JSON.stringify(packageJson.name)});`,
    `const schemaModule = await import(${JSON.stringify(`${packageJson.name}/schema`)}, { ${jsonImportAttribute}: { type: "json" } });`,
    "const schema = schemaModule.default;",
    "console.log(JSON.stringify({",
    "  exports: Object.keys(api).sort(),",
    "  contractVersion: schema.default.contractVersion,",
    "  schemaMatches: JSON.stringify(schema) === JSON.stringify(api.CONTRACT_SCHEMA)",
    "}));"
  ].join("\n");
  const imported = parseJson(await execute(
    process.execPath,
    ["--no-warnings", "--input-type=module", "--eval", importScript],
    { cwd: consumer }
  ));
  assert.deepEqual(imported, {
    exports: [
      "CONTRACT",
      "CONTRACT_SCHEMA",
      "doctor",
      "doctorRepository",
      "initRepository",
      "scanRepository",
      "syncRepository"
    ],
    contractVersion: 1,
    schemaMatches: true
  });

  async function runInstalledBrain(args) {
    return runNpm(
      [
        "exec",
        "--offline",
        "--yes=false",
        "--loglevel=error",
        "--cache",
        cache,
        "--",
        "brain",
        ...args
      ],
      { cwd: consumer, env: npmEnvironment }
    );
  }

  const help = await runInstalledBrain(["--help"]);
  assert.equal(help.exitCode, 0, help.stderr);
  assert.equal(help.stderr, "");
  assert.deepEqual(
    [...help.stdout.matchAll(/^  brain (\w+)/gmu)].map((match) => match[1]),
    ["init", "sync", "doctor"]
  );

  const version = await runInstalledBrain(["--version"]);
  assert.equal(version.exitCode, 0, version.stderr);
  assert.equal(version.stderr, "");
  assert.equal(version.stdout, `${packageJson.version}\n`);

  const initialized = parseJson(await runInstalledBrain(["init", repository, "--json"]));
  assert.deepEqual(initialized.created.sort(), [
    "AGENTS.md",
    "AI_CONTEXT/CONTEXT.md",
    "AI_CONTEXT/DECISIONS.md",
    "AI_CONTEXT/LEARNINGS.md",
    "AI_CONTEXT/TASKS.md"
  ]);

  const diagnosis = parseJson(await runInstalledBrain(["doctor", repository, "--json"]));
  assert.equal(diagnosis.ok, true);
  assert.deepEqual(diagnosis.errors, []);
  assert.deepEqual(diagnosis.warnings, []);
});
