import { uniqueSorted } from "../../shared/fs-utils";

import type { DependencyManifest, LoggingInfo } from "../../shared/types";

const LOGGING_DEPENDENCIES = [
  "pino",
  "winston",
  "bunyan",
  "loguru",
  "structlog",
  "logback",
  "serilog"
];

const STRUCTURED_LOGGING_DEPENDENCIES = ["pino", "winston", "loguru", "structlog", "serilog"];

export function detectLogging(files: string[], manifests: DependencyManifest[]): LoggingInfo {
  const dependencySet = new Set(
    manifests.flatMap((manifest) => manifest.dependencies.map((dependency) => dependency.toLowerCase()))
  );
  const frameworks = LOGGING_DEPENDENCIES.filter((dependency) => dependencySet.has(dependency));
  const configFiles = files.filter((file) => /log(back|ging)|logger/i.test(file));

  return {
    frameworks: uniqueSorted(frameworks),
    configFiles: uniqueSorted(configFiles),
    structured: frameworks.some((framework) => STRUCTURED_LOGGING_DEPENDENCIES.includes(framework))
  };
}
