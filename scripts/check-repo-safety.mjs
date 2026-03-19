import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const scanMode = args.has("--all") ? "all" : "staged";

const blockedDirPrefixes = [
  "node_modules/",
  "dist/",
  "build/",
  "coverage/",
  "cache/",
  ".cache/",
  "tmp/",
  ".tmp/",
  "logs/",
  "sample-output/",
  "pb-output/",
  "project-brain/pb-output/"
];

const blockedBinarySuffixes = [".pem", ".p12", ".pfx"];
const blockedBinaryExact = [".envrc"];
const secretPatterns = [
  { label: "private key material", regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "OpenAI-style secret", regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: "GitHub personal access token", regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { label: "GitHub fine-grained token", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { label: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  {
    label: "credential assignment",
    regex: /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*["'][^"'\\n]{10,}["']/i
  }
];

function runGit(argsToRun) {
  return execFileSync("git", argsToRun, { encoding: "utf8" }).trim();
}

function listFiles() {
  if (scanMode === "all") {
    const output = runGit(["ls-files"]);
    return output ? output.split("\n").filter(Boolean) : [];
  }

  const output = runGit(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return output ? output.split("\n").filter(Boolean) : [];
}

function isBlockedEnvFile(filePath) {
  const baseName = path.basename(filePath);
  if (!baseName.startsWith(".env")) {
    return false;
  }

  return !/\.env\.(example|sample)$/i.test(baseName);
}

function blockedPathReason(filePath) {
  if (isBlockedEnvFile(filePath)) {
    return "environment files must not be committed";
  }

  if (blockedBinaryExact.includes(path.basename(filePath))) {
    return "shell env files must stay local";
  }

  if (blockedDirPrefixes.some((prefix) => filePath.startsWith(prefix))) {
    return "generated or local-only path";
  }

  if (blockedBinarySuffixes.some((suffix) => filePath.toLowerCase().endsWith(suffix))) {
    return "binary credential material must not be committed";
  }

  if (filePath.toLowerCase().endsWith(".key") && !filePath.startsWith("tests/fixtures/")) {
    return "key files must not be committed outside fixtures";
  }

  return null;
}

function isProbablyTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const textExtensions = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".md",
    ".txt",
    ".yml",
    ".yaml",
    ".sh",
    ".env",
    ".toml",
    ".graphql"
  ]);

  return textExtensions.has(extension) || !extension;
}

function isPlaceholderValue(line) {
  return /(example|sample|changeme|replace[-_ ]?me|your[_-]?(key|token|secret)|placeholder|dummy)/i.test(line);
}

function collectAddedLinesFromStagedDiff(files) {
  if (!files.length) {
    return [];
  }

  const diff = execFileSync("git", ["diff", "--cached", "--unified=0", "--no-color", "--", ...files], {
    encoding: "utf8"
  });

  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1));
}

function collectAllFileLines(files) {
  const lines = [];

  for (const filePath of files) {
    if (!isProbablyTextFile(filePath)) {
      continue;
    }

    try {
      const fileStats = statSync(filePath);
      if (fileStats.size > 1024 * 1024) {
        continue;
      }

      const content = readFileSync(filePath, "utf8");
      lines.push(...content.split("\n"));
    } catch {
      // Ignore unreadable paths. Git should keep the tracked list coherent.
    }
  }

  return lines;
}

function findSecretHits(lines) {
  const hits = [];

  for (const line of lines) {
    if (isPlaceholderValue(line)) {
      continue;
    }

    for (const pattern of secretPatterns) {
      if (pattern.regex.test(line)) {
        hits.push({ label: pattern.label, line: line.trim() });
      }
    }
  }

  return hits;
}

const files = listFiles();
const blockers = [];

for (const filePath of files) {
  const reason = blockedPathReason(filePath);
  if (reason) {
    blockers.push(`blocked path: ${filePath} (${reason})`);
  }
}

const linesToScan = scanMode === "all" ? collectAllFileLines(files) : collectAddedLinesFromStagedDiff(files);
const secretHits = findSecretHits(linesToScan);

for (const hit of secretHits) {
  blockers.push(`secret-like content: ${hit.label} -> ${hit.line}`);
}

if (blockers.length > 0) {
  console.error(`project-brain repo safety check failed in ${scanMode} mode.`);
  for (const blocker of blockers) {
    console.error(`- ${blocker}`);
  }
  process.exit(1);
}

console.log(`project-brain repo safety check passed in ${scanMode} mode.`);
