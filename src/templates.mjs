import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_FILES } from "./contract.mjs";

const templateRoot = fileURLToPath(new URL("../templates/", import.meta.url));

export async function loadTemplates() {
  const entries = await Promise.all(
    REQUIRED_FILES.map(async (relativePath) => {
      const filePath = path.join(templateRoot, relativePath);
      const content = await readFile(filePath, "utf8");
      return [relativePath, content];
    })
  );
  return new Map(entries);
}
