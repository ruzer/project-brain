import { uniqueSorted } from "../../shared/fs-utils";

import type { DependencyManifest, MetricsInfo } from "../../shared/types";

const METRIC_DEPENDENCIES = [
  "@opentelemetry/api",
  "opentelemetry",
  "prom-client",
  "prometheus-client",
  "prometheus-fastapi-instrumentator",
  "sentry",
  "@sentry/node",
  "datadog",
  "dd-trace",
  "newrelic"
];

export function detectMetrics(files: string[], manifests: DependencyManifest[]): MetricsInfo {
  const dependencySet = new Set(
    manifests.flatMap((manifest) => manifest.dependencies.map((dependency) => dependency.toLowerCase()))
  );
  const tools = METRIC_DEPENDENCIES.filter((dependency) => dependencySet.has(dependency));
  const configFiles = files.filter((file) => /grafana|prometheus|otel|opentelemetry|sentry|newrelic|datadog/i.test(file));
  const alertsConfigured = files.some((file) => /alert|pagerduty|opsgenie/i.test(file));

  return {
    tools: uniqueSorted(tools),
    configFiles: uniqueSorted(configFiles),
    alertsConfigured
  };
}
