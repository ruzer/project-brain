import { uniqueSorted } from "../../shared/fs-utils";

import type { CiInfo } from "../../shared/types";

export function detectCi(files: string[]): CiInfo {
  const providers = new Set<string>();
  const configFiles: string[] = [];

  for (const file of files) {
    const lower = file.toLowerCase();

    if (lower.startsWith(".github/workflows/")) {
      providers.add("GitHub Actions");
      configFiles.push(file);
    }

    if (lower === ".gitlab-ci.yml") {
      providers.add("GitLab CI");
      configFiles.push(file);
    }

    if (lower === ".circleci/config.yml" || lower === "circle.yml") {
      providers.add("CircleCI");
      configFiles.push(file);
    }

    if (lower === "azure-pipelines.yml") {
      providers.add("Azure Pipelines");
      configFiles.push(file);
    }
  }

  return {
    providers: uniqueSorted([...providers]),
    configFiles: uniqueSorted(configFiles)
  };
}
