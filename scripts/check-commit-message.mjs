import { readFileSync } from "node:fs";

const messageFile = process.argv[2];

if (!messageFile) {
  console.error("commit message path is required");
  process.exit(1);
}

const firstLine = readFileSync(messageFile, "utf8")
  .split("\n")[0]
  .trim();

const blockedPrefixes = /^(wip|tmp|test|misc|stuff)([:\s-]|$)/i;

if (!firstLine) {
  console.error("commit message cannot be empty");
  process.exit(1);
}

if (blockedPrefixes.test(firstLine)) {
  console.error(`commit message is too weak: "${firstLine}"`);
  console.error("Use a short descriptive summary instead of WIP/tmp placeholders.");
  process.exit(1);
}

if (firstLine.length < 12) {
  console.error(`commit message is too short: "${firstLine}"`);
  console.error("Use at least 12 characters so the change is understandable in history.");
  process.exit(1);
}

if (!/[A-Za-z]/.test(firstLine)) {
  console.error(`commit message must contain readable text: "${firstLine}"`);
  process.exit(1);
}

console.log("commit message check passed.");
