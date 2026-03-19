import path from "node:path";

import { ensureDir, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  ContextGetResult,
  ContextRegistryEntry,
  ContextSearchHit,
  ContextSearchResult,
  ContextSourcesResult,
  ContextTrustLevel,
  ProjectContext
} from "../../shared/types";

const BUILTIN_REGISTRY: ContextRegistryEntry[] = [
  {
    id: "node-express-api",
    title: "Node + Express API Baseline",
    category: "backend",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://expressjs.com/",
    summary: "Baseline guidance for small-to-medium Node services using Express, explicit route boundaries, and operational middleware.",
    tags: ["node", "express", "api", "backend", "middleware", "service"],
    guidance: [
      "Keep route, service, and infrastructure boundaries explicit.",
      "Add structured logging, metrics, and error middleware early.",
      "Prefer contract-aware APIs and smoke tests for critical routes."
    ],
    relatedIds: ["vitest-testing-baseline", "structured-logging-node", "metrics-prometheus-node", "openapi-contracts"]
  },
  {
    id: "vitest-testing-baseline",
    title: "Vitest Testing Baseline",
    category: "testing",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://vitest.dev/",
    summary: "Minimal testing baseline for TypeScript and JavaScript repositories using Vitest for fast feedback and regression safety.",
    tags: ["vitest", "testing", "qa", "coverage", "regression", "typescript"],
    guidance: [
      "Start with smoke tests around core runtime paths and high-risk modules.",
      "Keep fast unit tests near business logic and integration tests near boundaries.",
      "Use coverage trends as a signal, not as the only quality gate."
    ],
    relatedIds: ["node-express-api", "review-delta-minimal-context"]
  },
  {
    id: "structured-logging-node",
    title: "Structured Logging for Node Services",
    category: "observability",
    trustLevel: "maintainer",
    source: "project-brain curated",
    sourceUrl: "https://getpino.io/",
    summary: "Guidance for JSON logs, request correlation, and log hygiene in Node backends.",
    tags: ["logging", "node", "pino", "json", "observability", "backend"],
    guidance: [
      "Emit machine-readable logs with stable field names.",
      "Attach request or job correlation ids at ingress boundaries.",
      "Avoid mixing user-facing errors with internal diagnostic detail."
    ],
    relatedIds: ["metrics-prometheus-node", "node-express-api"]
  },
  {
    id: "metrics-prometheus-node",
    title: "Prometheus Metrics for Node Services",
    category: "observability",
    trustLevel: "maintainer",
    source: "project-brain curated",
    sourceUrl: "https://prometheus.io/",
    summary: "Operational metrics baseline for latency, error rate, and resource usage in Node services.",
    tags: ["metrics", "prometheus", "prom-client", "latency", "slo", "observability"],
    guidance: [
      "Measure request rate, latency, and failure ratio for every critical surface.",
      "Track queue depth and background job health if asynchronous work exists.",
      "Pair metrics with alerting and runtime dashboards."
    ],
    relatedIds: ["structured-logging-node", "node-express-api"]
  },
  {
    id: "openapi-contracts",
    title: "OpenAPI Contract-First APIs",
    category: "api-design",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://www.openapis.org/",
    summary: "Treat OpenAPI as a durable contract for backend and consumer coordination.",
    tags: ["openapi", "swagger", "api", "contract", "schema", "backend"],
    guidance: [
      "Keep the spec close to the service and review it like code.",
      "Generate examples and contract tests for critical endpoints.",
      "Avoid undocumented drift between handlers and the published API."
    ],
    relatedIds: ["node-express-api", "github-actions-ci"]
  },
  {
    id: "github-actions-ci",
    title: "GitHub Actions CI Baseline",
    category: "delivery",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://docs.github.com/en/actions",
    summary: "Baseline CI guidance for validation, test partitioning, and artifact clarity in GitHub Actions.",
    tags: ["github-actions", "ci", "pipeline", "workflow", "build", "test"],
    guidance: [
      "Run typecheck, build, and the smallest useful test set on every change.",
      "Keep workflow steps explicit and observable instead of hiding too much inside scripts.",
      "Promote reproducible artifacts and clear failure output."
    ],
    relatedIds: ["vitest-testing-baseline", "docker-container-baseline"]
  },
  {
    id: "docker-container-baseline",
    title: "Docker Service Container Baseline",
    category: "infrastructure",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://docs.docker.com/",
    summary: "Baseline guidance for containerized apps with small images, explicit runtime contracts, and safer defaults.",
    tags: ["docker", "container", "image", "runtime", "deployment", "infra"],
    guidance: [
      "Use multi-stage builds and keep runtime images minimal.",
      "Make health endpoints and environment contracts explicit.",
      "Run as non-root where possible and keep dependency surfaces tight."
    ],
    relatedIds: ["github-actions-ci", "terraform-infra-modules"]
  },
  {
    id: "react-frontend-foundations",
    title: "React Frontend Foundations",
    category: "frontend",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://react.dev/",
    summary: "Operational baseline for React apps with clear state boundaries, route ownership, and UI safety checks.",
    tags: ["react", "frontend", "ui", "state", "routing", "experience"],
    guidance: [
      "Separate presentation from data access and state orchestration.",
      "Keep navigation, loading states, and empty states intentional.",
      "Document component ownership for complex shells and dashboards."
    ],
    relatedIds: ["nextjs-application", "vitest-testing-baseline"]
  },
  {
    id: "nextjs-application",
    title: "Next.js Application Baseline",
    category: "frontend",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://nextjs.org/docs",
    summary: "Baseline guidance for Next.js apps with route structure, server/client boundaries, and deployment clarity.",
    tags: ["nextjs", "react", "frontend", "ssr", "app-router", "deployment"],
    guidance: [
      "Be explicit about server and client boundaries.",
      "Keep data fetching close to route ownership and cache rules.",
      "Document env vars and hosting assumptions early."
    ],
    relatedIds: ["react-frontend-foundations", "github-actions-ci"]
  },
  {
    id: "nestjs-service",
    title: "NestJS Service Baseline",
    category: "backend",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://docs.nestjs.com/",
    summary: "Baseline guidance for NestJS services with modular boundaries, DTO validation, and operational clarity.",
    tags: ["nestjs", "backend", "typescript", "service", "module", "api"],
    guidance: [
      "Use modules to express real boundaries, not just folders.",
      "Validate DTOs and keep transport contracts explicit.",
      "Make background workers and side effects observable."
    ],
    relatedIds: ["openapi-contracts", "structured-logging-node"]
  },
  {
    id: "terraform-infra-modules",
    title: "Terraform Infrastructure Modules",
    category: "infrastructure",
    trustLevel: "maintainer",
    source: "project-brain curated",
    sourceUrl: "https://developer.hashicorp.com/terraform/docs",
    summary: "Baseline guidance for modular Terraform stacks with clear ownership and plan safety.",
    tags: ["terraform", "infra", "iac", "module", "plan", "cloud"],
    guidance: [
      "Keep reusable modules small and explicit about inputs/outputs.",
      "Separate shared foundations from service-specific stacks.",
      "Review plan diffs and destructive changes carefully."
    ],
    relatedIds: ["docker-container-baseline", "security-baseline"]
  },
  {
    id: "python-fastapi-service",
    title: "Python FastAPI Service Baseline",
    category: "backend",
    trustLevel: "official",
    source: "project-brain curated",
    sourceUrl: "https://fastapi.tiangolo.com/",
    summary: "Baseline guidance for FastAPI services with typed contracts, clear dependency injection, and route-level observability.",
    tags: ["python", "fastapi", "backend", "api", "typing", "service"],
    guidance: [
      "Keep request and response models explicit and versioned where needed.",
      "Separate domain logic from transport and persistence concerns.",
      "Add health checks, logging, and metrics around ingress points."
    ],
    relatedIds: ["openapi-contracts", "security-baseline"]
  },
  {
    id: "security-baseline",
    title: "Application Security Baseline",
    category: "security",
    trustLevel: "community",
    source: "project-brain curated",
    sourceUrl: "https://owasp.org/",
    summary: "A cross-stack baseline for secrets handling, dependency hygiene, auth boundaries, and approval discipline.",
    tags: ["security", "auth", "secret", "dependency", "compliance", "approval"],
    guidance: [
      "Treat secrets, auth, and permission changes as high-risk surfaces.",
      "Audit dependency updates and external integrations before promotion.",
      "Make approval boundaries explicit for destructive or production-adjacent actions."
    ],
    relatedIds: ["structured-logging-node", "terraform-infra-modules", "github-actions-ci"]
  },
  {
    id: "review-delta-minimal-context",
    title: "Minimal Review Context Pattern",
    category: "workflow",
    trustLevel: "community",
    source: "project-brain curated",
    sourceUrl: "https://github.com/tirth8205/code-review-graph",
    summary: "Review only the files, dependents, and tests that materially reduce uncertainty for a given delta.",
    tags: ["review", "delta", "impact", "graph", "tests", "workflow"],
    guidance: [
      "Start from changed files, then expand only to direct and transitive dependents.",
      "Pull in relevant tests and contracts before adding more context.",
      "Keep the review surface intentionally small to improve signal."
    ],
    relatedIds: ["vitest-testing-baseline", "node-express-api"]
  }
];

interface RegistryPaths {
  baseDir: string;
  cacheDir: string;
  externalContextDir: string;
  searchReportPath: string;
  sourcesReportPath: string;
}

function registryPaths(outputPath: string): RegistryPaths {
  const baseDir = path.join(outputPath, "memory", "context_registry");
  return {
    baseDir,
    cacheDir: path.join(baseDir, "cache"),
    externalContextDir: path.join(outputPath, "AI_CONTEXT", "EXTERNAL_CONTEXT"),
    searchReportPath: path.join(outputPath, "reports", "context_search.md"),
    sourcesReportPath: path.join(outputPath, "reports", "context_sources.md")
  };
}

function normalizeTokens(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function scoreEntry(entry: ContextRegistryEntry, queryTokens: string[]): ContextSearchHit | undefined {
  const titleTokens = normalizeTokens(entry.title);
  const summaryTokens = normalizeTokens(entry.summary);
  const categoryTokens = normalizeTokens(entry.category);
  const idTokens = normalizeTokens(entry.id);
  const tagTokens = entry.tags.flatMap((tag) => normalizeTokens(tag));
  const allTagTokens = new Set(tagTokens);
  const matchedTags = queryTokens.filter((token) => allTagTokens.has(token));

  let score = 0;

  for (const token of queryTokens) {
    if (entry.id === token || entry.id.includes(token)) {
      score += 6;
    }
    if (titleTokens.includes(token)) {
      score += 4;
    }
    if (tagTokens.includes(token)) {
      score += 3;
    }
    if (summaryTokens.includes(token) || categoryTokens.includes(token) || idTokens.includes(token)) {
      score += 2;
    }
  }

  if (entry.trustLevel === "official") {
    score += 0.5;
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    entry,
    score,
    matchedTags: unique(matchedTags).sort((left, right) => left.localeCompare(right))
  };
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function entryMarkdown(entry: ContextRegistryEntry): string {
  return `# ${entry.title}

## Metadata

- ID: ${entry.id}
- Category: ${entry.category}
- Trust: ${entry.trustLevel}
- Source: ${entry.source}
- Source URL: ${entry.sourceUrl}

## Summary

${entry.summary}

## Guidance

${renderList(entry.guidance)}

## Tags

${renderList(entry.tags)}

## Related entries

${renderList(entry.relatedIds)}
`;
}

export async function searchContextRegistry(
  context: ProjectContext,
  query: string,
  trust?: ContextTrustLevel
): Promise<ContextSearchResult> {
  const paths = registryPaths(context.outputPath);
  await ensureDir(paths.baseDir);
  await ensureDir(paths.cacheDir);
  await ensureDir(paths.externalContextDir);

  const queryTokens = normalizeTokens(query);
  const hits = BUILTIN_REGISTRY
    .filter((entry) => !trust || entry.trustLevel === trust)
    .map((entry) => scoreEntry(entry, queryTokens))
    .filter(Boolean)
    .sort((left, right) => right!.score - left!.score || left!.entry.id.localeCompare(right!.entry.id))
    .slice(0, 8) as ContextSearchHit[];

  const cachePath = path.join(paths.baseDir, "last_search.json");
  await writeJsonEnsured(cachePath, {
    query,
    trust: trust ?? "any",
    hits
  });
  await writeFileEnsured(
    paths.searchReportPath,
    `# Context Search

## Query

- Query: ${query}
- Trust filter: ${trust ?? "any"}
- Hits: ${hits.length}

## Matches

${hits.length > 0
        ? hits
            .map(
              (hit) => `## ${hit.entry.title}

- ID: ${hit.entry.id}
- Trust: ${hit.entry.trustLevel}
- Category: ${hit.entry.category}
- Score: ${hit.score}
- Matched tags: ${hit.matchedTags.join(", ") || "None"}
- Source: ${hit.entry.sourceUrl}

${hit.entry.summary}
`
            )
            .join("\n")
        : "- No matches found."}
`
  );

  return {
    context,
    query,
    reportPath: paths.searchReportPath,
    cachePath,
    hits
  };
}

export async function getContextRegistryEntry(context: ProjectContext, id: string): Promise<ContextGetResult> {
  const entry = BUILTIN_REGISTRY.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`Unknown context entry: ${id}`);
  }

  const paths = registryPaths(context.outputPath);
  await ensureDir(paths.baseDir);
  await ensureDir(paths.cacheDir);
  await ensureDir(paths.externalContextDir);

  const artifactPath = path.join(paths.externalContextDir, `${entry.id}.md`);
  const cachePath = path.join(paths.cacheDir, `${entry.id}.json`);

  await writeFileEnsured(artifactPath, entryMarkdown(entry));
  await writeJsonEnsured(cachePath, entry);

  return {
    context,
    entry,
    artifactPath,
    cachePath
  };
}

export async function listContextSources(context: ProjectContext): Promise<ContextSourcesResult> {
  const paths = registryPaths(context.outputPath);
  await ensureDir(paths.baseDir);
  await ensureDir(paths.cacheDir);
  await ensureDir(paths.externalContextDir);

  const grouped = new Map<string, { source: string; trustLevel: ContextTrustLevel; entries: number }>();
  for (const entry of BUILTIN_REGISTRY) {
    const key = `${entry.source}:${entry.trustLevel}`;
    const current = grouped.get(key);
    if (current) {
      current.entries += 1;
    } else {
      grouped.set(key, {
        source: entry.source,
        trustLevel: entry.trustLevel,
        entries: 1
      });
    }
  }

  const sources = [...grouped.values()].sort(
    (left, right) => right.entries - left.entries || left.source.localeCompare(right.source)
  );

  await writeFileEnsured(
    paths.sourcesReportPath,
    `# Context Sources

## Sources

${sources.map((source) => `- ${source.source} | trust=${source.trustLevel} | entries=${source.entries}`).join("\n")}
`
  );

  return {
    context,
    reportPath: paths.sourcesReportPath,
    sources
  };
}
