import path from "node:path";

import { ensureDir, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";
import type {
  ContextRegistryEntry,
  ContextTrustLevel,
  EcosystemRadarCandidate,
  EcosystemRadarResult,
  ProjectContext
} from "../../shared/types";
import { contextRegistryPaths, writeDynamicContextRegistryEntries } from "./index";

interface RadarSeedRepo {
  id: string;
  fullName: string;
  title: string;
  category: string;
  summary: string;
  tags: string[];
  guidance: string[];
  relatedIds: string[];
  keywords: string[];
}

interface RadarBucket {
  id: string;
  title: string;
  query: string;
  category: string;
  keywords: string[];
  guidance: string[];
  relatedIds: string[];
}

interface GitHubRepoRecord {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  topics?: string[];
  pushed_at?: string;
  default_branch?: string;
  archived?: boolean;
  disabled?: boolean;
  homepage?: string | null;
  license?: {
    spdx_id?: string | null;
    name?: string | null;
  } | null;
  owner: {
    login: string;
  };
}

interface GitHubSearchResponse {
  items: GitHubRepoRecord[];
}

interface GitHubReadmeResponse {
  content?: string;
  encoding?: string;
}

const RADAR_SEEDS: RadarSeedRepo[] = [
  {
    id: "repomix-context-ingestion",
    fullName: "yamadashy/repomix",
    title: "Repomix Context Ingestion",
    category: "context-ingestion",
    summary: "Reference for packing repositories into AI-friendly context bundles with filters, token-aware output, and repo-to-prompt workflows.",
    tags: ["repomix", "context", "ingestion", "repo-packing", "tokens", "prompt"],
    guidance: [
      "Use it as a reference for repo-to-context export, ignore rules, and token-budget aware packaging.",
      "Extract packaging patterns into project-brain reports or prompts instead of embedding another runtime wholesale.",
      "Compare its include/exclude surface with context-lite and external repository workflows."
    ],
    relatedIds: ["nextjs-application", "react-frontend-foundations"],
    keywords: ["context", "repo", "pack", "prompt", "tokens", "ingest"]
  },
  {
    id: "gitingest-repo-ingestion",
    fullName: "coderamp-labs/gitingest",
    title: "Gitingest Repository Ingestion",
    category: "context-ingestion",
    summary: "Reference for ingesting a Git repository into compact, prompt-friendly context that downstream agents can consume quickly.",
    tags: ["gitingest", "context", "repo", "ingestion", "prompt", "analysis"],
    guidance: [
      "Use it to benchmark how fast project-brain can derive compact onboarding context from a cold repo.",
      "Borrow ideas around prompt-friendly shaping, not around replacing the local memory model.",
      "Contrast its output with AI_CONTEXT and context-lite summaries."
    ],
    relatedIds: ["repomix-context-ingestion"],
    keywords: ["context", "ingest", "repo", "prompt", "summary"]
  },
  {
    id: "ast-grep-structural-search",
    fullName: "ast-grep/ast-grep",
    title: "ast-grep Structural Search",
    category: "code-analysis",
    summary: "Reference for structural code search, linting, and AST-aware pattern matching that can strengthen evidence collection beyond plain text grep.",
    tags: ["ast-grep", "ast", "search", "lint", "rewrite", "static-analysis"],
    guidance: [
      "Use it to improve code-surface discovery where ripgrep is too shallow or too noisy.",
      "Prefer structural search for navigation, API handlers, and contract patterns that depend on syntax shape.",
      "Keep it optional and read-first before considering any rewrite workflow."
    ],
    relatedIds: ["review-delta-minimal-context"],
    keywords: ["ast", "structural", "search", "rewrite", "lint", "pattern"]
  },
  {
    id: "langgraph-agent-graphs",
    fullName: "langchain-ai/langgraph",
    title: "LangGraph Agent Graphs",
    category: "agent-runtime",
    summary: "Reference for resilient agent runtimes modeled as graphs with explicit state transitions, retries, and durable execution patterns.",
    tags: ["langgraph", "agents", "graph", "runtime", "orchestration", "state"],
    guidance: [
      "Use it to benchmark stateful orchestration patterns for planner, synthesis, and retry flows.",
      "Borrow graph and checkpoint ideas where project-brain needs stronger long-running workflow boundaries.",
      "Avoid coupling project-brain to a framework unless the boundary stays optional."
    ],
    relatedIds: ["review-delta-minimal-context"],
    keywords: ["agent", "graph", "runtime", "orchestration", "state", "workflow"]
  },
  {
    id: "deepagentsjs-subagents",
    fullName: "langchain-ai/deepagentsjs",
    title: "DeepAgentsJS Subagent Runtime",
    category: "agent-runtime",
    summary: "Reference for deep planning, filesystem-aware agents, and subagent delegation in JavaScript runtimes.",
    tags: ["deepagents", "subagents", "planning", "filesystem", "langchain", "runtime"],
    guidance: [
      "Use it as the benchmark for the optional deep agent path, not as a replacement for project-brain governance.",
      "Borrow planning and subagent decomposition ideas where swarm needs more autonomy.",
      "Keep repo access read-only and bounded when importing these patterns."
    ],
    relatedIds: ["langgraph-agent-graphs"],
    keywords: ["deepagents", "subagent", "planning", "filesystem", "agent"]
  },
  {
    id: "langmem-agent-memory",
    fullName: "langchain-ai/langmem",
    title: "LangMem Agent Memory",
    category: "memory",
    summary: "Reference for explicit memory extraction, persistence, and background memory workflows for agents.",
    tags: ["langmem", "memory", "agents", "learning", "persistence", "background"],
    guidance: [
      "Use it to benchmark how project-brain stores learnings, durable context, and post-run memory extraction.",
      "Focus on memory lifecycle and recall quality, not on adopting a framework wholesale.",
      "Contrast it with DECISIONS, LEARNINGS, TASKS, and persistent context store behavior."
    ],
    relatedIds: ["deepagentsjs-subagents", "langgraph-agent-graphs"],
    keywords: ["memory", "agents", "learning", "recall", "persistence"]
  },
  {
    id: "aider-terminal-coding-loop",
    fullName: "Aider-AI/aider",
    title: "Aider Terminal Coding Loop",
    category: "developer-loop",
    summary: "Reference for terminal-first AI coding loops, diff discipline, and developer-controlled editing workflows.",
    tags: ["aider", "terminal", "coding", "diff", "workflow", "developer-loop"],
    guidance: [
      "Use it to benchmark how project-brain should hand off context and tasks into a coding loop without taking over edits.",
      "Borrow interaction patterns around diff review, user control, and small-surface changes.",
      "Keep project-brain focused on intelligence and review, not direct code ownership."
    ],
    relatedIds: ["review-delta-minimal-context"],
    keywords: ["terminal", "coding", "diff", "workflow", "review"]
  },
  {
    id: "continue-source-controlled-ai",
    fullName: "continuedev/continue",
    title: "Continue Source-Controlled AI",
    category: "developer-loop",
    summary: "Reference for source-controlled AI checks, prompts, and review workflows that live close to the codebase.",
    tags: ["continue", "checks", "prompts", "review", "source-controlled", "developer-loop"],
    guidance: [
      "Use it to benchmark project-brain prompt registries, review checks, and repo-local AI configuration patterns.",
      "Borrow ideas for controlled checks and repo-owned prompt surfaces.",
      "Keep project-brain outputs auditable and review-first."
    ],
    relatedIds: ["github-actions-ci", "review-delta-minimal-context"],
    keywords: ["checks", "review", "prompt", "source-controlled", "config"]
  },
  {
    id: "openhands-agent-runtime",
    fullName: "OpenHands/OpenHands",
    title: "OpenHands Agent Runtime",
    category: "agent-runtime",
    summary: "Reference for AI-driven development runtimes with task execution, tooling boundaries, and developer-facing orchestration.",
    tags: ["openhands", "agents", "runtime", "automation", "tooling", "developer-loop"],
    guidance: [
      "Use it to benchmark runtime UX, task orchestration, and execution boundaries for local agent workflows.",
      "Borrow patterns for bounded tool execution and operator visibility.",
      "Do not collapse project-brain into a general-purpose coding runtime."
    ],
    relatedIds: ["deepagentsjs-subagents", "aider-terminal-coding-loop"],
    keywords: ["agent", "runtime", "execution", "tooling", "automation"]
  }
];

const RADAR_BUCKETS: RadarBucket[] = [
  {
    id: "agent-runtime",
    title: "Agent runtimes and orchestration",
    query: "\"agent runtime\" OR \"agent framework\" in:description,readme stars:>200",
    category: "agent-runtime",
    keywords: ["agent", "runtime", "framework", "orchestration", "workflow", "planning"],
    guidance: [
      "Prioritize repos with explicit task/state boundaries over hype-only wrappers.",
      "Look for read-only analysis patterns, approval gates, and durable execution models."
    ],
    relatedIds: ["deepagentsjs-subagents", "langgraph-agent-graphs", "openhands-agent-runtime"]
  },
  {
    id: "context-ingestion",
    title: "Repository context ingestion",
    query: "\"repo context\" OR \"repository context\" OR ingest in:description,readme stars:>50",
    category: "context-ingestion",
    keywords: ["context", "repo", "repository", "ingest", "prompt", "pack"],
    guidance: [
      "Favor repos that convert codebases into compact, prompt-friendly, reproducible context bundles.",
      "Extract packaging and filtering patterns that improve context-lite."
    ],
    relatedIds: ["repomix-context-ingestion", "gitingest-repo-ingestion"]
  },
  {
    id: "developer-loop",
    title: "Developer-controlled AI loops",
    query: "\"AI pair programming\" OR \"coding assistant\" in:description,readme stars:>200",
    category: "developer-loop",
    keywords: ["coding", "assistant", "review", "diff", "terminal", "developer"],
    guidance: [
      "Favor repos that preserve user control, show diffs clearly, and avoid opaque automation.",
      "Use these as references for handoff UX, not for replacing project-brain."
    ],
    relatedIds: ["aider-terminal-coding-loop", "continue-source-controlled-ai"]
  },
  {
    id: "memory",
    title: "Agent memory systems",
    query: "\"agent memory\" OR langmem in:description,readme stars:>50",
    category: "memory",
    keywords: ["memory", "agent", "recall", "learning", "persistence", "context"],
    guidance: [
      "Favor repos with explicit memory extraction, storage, and recall semantics.",
      "Use them to harden LEARNINGS and persistent context instead of adding vague chat history."
    ],
    relatedIds: ["langmem-agent-memory"]
  },
  {
    id: "code-analysis",
    title: "Structural code analysis",
    query: "\"structural search\" OR \"AST search\" in:description,readme stars:>100",
    category: "code-analysis",
    keywords: ["ast", "search", "structural", "analysis", "lint", "rewrite"],
    guidance: [
      "Favor repos that provide syntax-aware search and rule systems over raw text matching.",
      "Use them to improve evidence quality in reports and domain extraction."
    ],
    relatedIds: ["ast-grep-structural-search"]
  }
];

function normalizeTokens(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function githubApiBaseUrl(): string {
  return (process.env.PROJECT_BRAIN_GITHUB_API_BASE_URL ?? "https://api.github.com").replace(/\/+$/, "");
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "project-brain-ecosystem-radar"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchGitHubJson<T>(resourcePath: string): Promise<T> {
  const response = await fetch(`${githubApiBaseUrl()}${resourcePath}`, {
    headers: githubHeaders()
  });

  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${resourcePath}`);
  }

  return response.json() as Promise<T>;
}

async function searchRepositories(query: string, perPage: number): Promise<GitHubRepoRecord[]> {
  const payload = await fetchGitHubJson<GitHubSearchResponse>(
    `/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perPage}`
  );
  return payload.items ?? [];
}

async function fetchRepository(fullName: string): Promise<GitHubRepoRecord> {
  return fetchGitHubJson<GitHubRepoRecord>(`/repos/${fullName}`);
}

async function fetchRepositoryReadme(fullName: string): Promise<string | undefined> {
  const payload = await fetchGitHubJson<GitHubReadmeResponse>(`/repos/${fullName}/readme`);
  if (!payload.content || payload.encoding !== "base64") {
    return undefined;
  }

  return Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
}

function extractReadmeSummary(markdown: string): string | undefined {
  if (!markdown.trim()) {
    return undefined;
  }

  const paragraphs = markdown
    .split(/\n\s*\n/g)
    .map((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && !line.startsWith("![") && !line.startsWith("[!"))
        .join(" ")
        .replace(/`/g, "")
        .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((paragraph) => paragraph.length >= 40);

  return paragraphs[0]?.slice(0, 280);
}

function daysSince(dateValue?: string): number | undefined {
  if (!dateValue) {
    return undefined;
  }

  const parsed = Date.parse(dateValue);
  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function permissiveLicenseScore(license?: GitHubRepoRecord["license"]): number {
  const value = (license?.spdx_id ?? license?.name ?? "").toUpperCase();
  const permissiveLicenses = new Set(["MIT", "APACHE-2.0", "BSD-3-CLAUSE", "BSD-2-CLAUSE", "ISC", "MPL-2.0"]);
  return permissiveLicenses.has(value) ? 0.6 : 0;
}

function starsScore(stars: number): number {
  if (stars >= 50_000) {
    return 3.2;
  }
  if (stars >= 10_000) {
    return 2.6;
  }
  if (stars >= 1_000) {
    return 1.8;
  }
  if (stars >= 200) {
    return 1.2;
  }
  return stars > 0 ? 0.6 : 0;
}

function activityScore(pushedAt?: string): number {
  const age = daysSince(pushedAt);
  if (age === undefined) {
    return 0;
  }
  if (age <= 30) {
    return 2;
  }
  if (age <= 90) {
    return 1.5;
  }
  if (age <= 180) {
    return 1;
  }
  if (age <= 365) {
    return 0.5;
  }
  return 0;
}

function keywordScore(text: string, keywords: string[]): { score: number; matches: string[] } {
  const tokens = new Set(normalizeTokens(text));
  const matches = unique(keywords.filter((keyword) => tokens.has(keyword.toLowerCase())));
  return {
    score: Math.min(2, matches.length * 0.35),
    matches
  };
}

function buildFallbackRepository(seed: RadarSeedRepo): GitHubRepoRecord {
  const [owner, name] = seed.fullName.split("/");
  return {
    name,
    full_name: seed.fullName,
    html_url: `https://github.com/${seed.fullName}`,
    description: seed.summary,
    stargazers_count: 0,
    forks_count: 0,
    language: null,
    topics: seed.tags,
    owner: {
      login: owner
    }
  };
}

function buildContextEntry(
  repo: GitHubRepoRecord,
  summary: string,
  trustLevel: ContextTrustLevel,
  source: string,
  category: string,
  tags: string[],
  guidance: string[],
  relatedIds: string[],
  entryId?: string,
  title?: string
): ContextRegistryEntry {
  return {
    id: entryId ?? `github-${slugify(repo.full_name)}`,
    title: title ?? `${repo.name} (${repo.owner.login})`,
    category,
    trustLevel,
    source,
    sourceUrl: repo.html_url,
    summary,
    tags: unique(tags),
    guidance: unique(guidance),
    relatedIds: unique(relatedIds)
  };
}

function buildCandidate(
  repo: GitHubRepoRecord,
  readmeSummary: string | undefined,
  seed: RadarSeedRepo | undefined,
  bucket: RadarBucket | undefined
): EcosystemRadarCandidate {
  const category = seed?.category ?? bucket?.category ?? "ecosystem";
  const trustLevel: ContextTrustLevel = "maintainer";
  const combinedText = [repo.description ?? "", readmeSummary ?? "", ...(repo.topics ?? [])].join(" ");
  const keywords = unique([...(seed?.keywords ?? []), ...(bucket?.keywords ?? [])]);
  const keywordSignals = keywordScore(combinedText, keywords);
  const scoreParts: Array<{ value: number; reason: string }> = [];

  if (seed) {
    scoreParts.push({ value: 2.5, reason: "repo curado para Project Brain" });
  }
  if (repo.archived || repo.disabled) {
    scoreParts.push({ value: -4, reason: "repo archivado o deshabilitado" });
  }

  const starValue = starsScore(repo.stargazers_count);
  if (starValue > 0) {
    scoreParts.push({ value: starValue, reason: `${repo.stargazers_count} stars` });
  }

  const activityValue = activityScore(repo.pushed_at);
  if (activityValue > 0) {
    scoreParts.push({ value: activityValue, reason: `actividad reciente (${daysSince(repo.pushed_at)} dias)` });
  }

  const licenseValue = permissiveLicenseScore(repo.license);
  if (licenseValue > 0) {
    scoreParts.push({ value: licenseValue, reason: `licencia permisiva (${repo.license?.spdx_id ?? repo.license?.name})` });
  }

  if (readmeSummary) {
    scoreParts.push({ value: 0.4, reason: "README util para contexto operativo" });
  }

  if (repo.language && ["typescript", "javascript", "python", "rust", "go"].includes(repo.language.toLowerCase())) {
    scoreParts.push({ value: 0.4, reason: `stack afín (${repo.language})` });
  }

  if (keywordSignals.score > 0) {
    scoreParts.push({ value: keywordSignals.score, reason: `fit por keywords (${keywordSignals.matches.join(", ")})` });
  }

  const score = Number(scoreParts.reduce((total, part) => total + part.value, 0).toFixed(2));
  const summary =
    seed?.summary ??
    repo.description ??
    readmeSummary ??
    `${repo.full_name} puede servir como referencia para ${category} dentro de project-brain.`;
  const guidance = seed?.guidance ?? bucket?.guidance ?? [
    "Inspecciona README, superficie CLI y límites operativos antes de copiar patrones.",
    "Extrae ideas puntuales; no reemplaces project-brain por el runtime externo."
  ];
  const tags = [
    ...(seed?.tags ?? []),
    ...(repo.topics ?? []),
    ...(repo.language ? [repo.language.toLowerCase()] : []),
    category,
    ...(bucket ? [bucket.id] : [])
  ];
  const relatedIds = [...(seed?.relatedIds ?? []), ...(bucket?.relatedIds ?? [])];
  const entry = buildContextEntry(
    repo,
    summary,
    trustLevel,
    seed ? "github-radar curated" : "github-radar search",
    category,
    tags,
    guidance,
    relatedIds,
    seed?.id,
    seed?.title
  );

  return {
    entry,
    repoFullName: repo.full_name,
    bucketId: bucket?.id ?? category,
    score,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    primaryLanguage: repo.language ?? undefined,
    pushedAt: repo.pushed_at,
    reasons: scoreParts.filter((part) => part.value !== 0).map((part) => part.reason)
  };
}

async function hydrateSeed(seed: RadarSeedRepo, notes: string[]): Promise<EcosystemRadarCandidate> {
  try {
    const [repo, readme] = await Promise.allSettled([
      fetchRepository(seed.fullName),
      fetchRepositoryReadme(seed.fullName)
    ]);

    const hydratedRepo = repo.status === "fulfilled" ? repo.value : buildFallbackRepository(seed);
    if (repo.status !== "fulfilled") {
      notes.push(`No se pudo leer metadata GitHub para ${seed.fullName}; se usó el seed local.`);
    }

    if (readme.status !== "fulfilled") {
      notes.push(`No se pudo leer README para ${seed.fullName}; se usó resumen local.`);
    }

    return buildCandidate(
      hydratedRepo,
      readme.status === "fulfilled" ? extractReadmeSummary(readme.value ?? "") : undefined,
      seed,
      undefined
    );
  } catch (error) {
    notes.push(`Fallo inesperado al hidratar seed ${seed.fullName}: ${String(error)}`);
    return buildCandidate(buildFallbackRepository(seed), undefined, seed, undefined);
  }
}

async function hydrateDiscoveredRepo(
  repo: GitHubRepoRecord,
  bucket: RadarBucket,
  notes: string[]
): Promise<EcosystemRadarCandidate> {
  let hydratedRepo = repo;
  let readmeSummary: string | undefined;

  try {
    hydratedRepo = await fetchRepository(repo.full_name);
  } catch (error) {
    notes.push(`No se pudo ampliar metadata de ${repo.full_name}: ${String(error)}`);
  }

  try {
    const readme = await fetchRepositoryReadme(repo.full_name);
    readmeSummary = extractReadmeSummary(readme ?? "");
  } catch (error) {
    notes.push(`No se pudo leer README de ${repo.full_name}: ${String(error)}`);
  }

  return buildCandidate(hydratedRepo, readmeSummary, undefined, bucket);
}

function pickBuckets(bucketId?: string): RadarBucket[] {
  return bucketId ? RADAR_BUCKETS.filter((bucket) => bucket.id === bucketId) : RADAR_BUCKETS;
}

function pickSeeds(bucketId?: string): RadarSeedRepo[] {
  if (!bucketId) {
    return RADAR_SEEDS;
  }

  const bucket = RADAR_BUCKETS.find((candidate) => candidate.id === bucketId);
  if (!bucket) {
    return [];
  }

  const relatedIds = new Set(bucket.relatedIds);
  return RADAR_SEEDS.filter(
    (seed) =>
      seed.category === bucket.category ||
      relatedIds.has(seed.id) ||
      seed.relatedIds.some((relatedId) => relatedIds.has(relatedId))
  );
}

function renderCandidate(candidate: EcosystemRadarCandidate): string {
  return `## ${candidate.entry.title}

- Repo: ${candidate.repoFullName}
- Source: ${candidate.entry.sourceUrl}
- Category: ${candidate.entry.category}
- Bucket: ${candidate.bucketId}
- Score: ${candidate.score}
- Stars/Forks: ${candidate.stars}/${candidate.forks}
- Primary language: ${candidate.primaryLanguage ?? "unknown"}
- Last push: ${candidate.pushedAt ?? "unknown"}
- Why it matters: ${candidate.reasons.join(" | ") || "seed curado"}

${candidate.entry.summary}
`;
}

export async function runEcosystemRadar(
  context: ProjectContext,
  options: {
    limit?: number;
    bucketId?: string;
    seedOnly?: boolean;
  } = {}
): Promise<EcosystemRadarResult> {
  const limit = Math.max(1, options.limit ?? 6);
  const seedOnly = options.seedOnly ?? false;
  const paths = contextRegistryPaths(context.outputPath);
  const reportPath = path.join(context.outputPath, "reports", "ecosystem_radar.md");
  const cachePath = path.join(paths.cacheDir, "ecosystem_radar.json");
  const notes: string[] = [];
  const buckets = pickBuckets(options.bucketId);

  await ensureDir(paths.baseDir);
  await ensureDir(paths.entriesDir);
  await ensureDir(paths.cacheDir);
  await ensureDir(paths.externalContextDir);

  if (!process.env.GITHUB_TOKEN) {
    notes.push("GITHUB_TOKEN no está configurado; GitHub API corre en modo público con rate limits más bajos.");
  }

  if (options.bucketId && buckets.length === 0) {
    notes.push(`No se encontró el bucket \`${options.bucketId}\`; el radar solo materializó seeds compatibles.`);
  }

  const selectedSeeds = pickSeeds(options.bucketId);
  const seedCandidates = await Promise.all(selectedSeeds.map((seed) => hydrateSeed(seed, notes)));
  const discoveredCandidates: EcosystemRadarCandidate[] = [];

  if (!seedOnly) {
    const seenRepositories = new Set(seedCandidates.map((candidate) => candidate.repoFullName.toLowerCase()));
    const rawDiscoveries = new Map<string, { repo: GitHubRepoRecord; bucket: RadarBucket }>();

    for (const bucket of buckets) {
      try {
        const searchHits = await searchRepositories(bucket.query, Math.max(limit, 4));
        for (const repo of searchHits) {
          const key = repo.full_name.toLowerCase();
          if (seenRepositories.has(key) || rawDiscoveries.has(key)) {
            continue;
          }
          rawDiscoveries.set(key, { repo, bucket });
        }
      } catch (error) {
        notes.push(`No se pudo consultar bucket ${bucket.id}: ${String(error)}`);
      }
    }

    const hydrated = await Promise.all(
      [...rawDiscoveries.values()]
        .sort((left, right) => right.repo.stargazers_count - left.repo.stargazers_count || left.repo.full_name.localeCompare(right.repo.full_name))
        .slice(0, Math.max(limit * 2, 8))
        .map(({ repo, bucket }) => hydrateDiscoveredRepo(repo, bucket, notes))
    );

    discoveredCandidates.push(
      ...hydrated
        .sort((left, right) => right.score - left.score || left.repoFullName.localeCompare(right.repoFullName))
        .slice(0, limit)
    );
  }

  const candidates = [...seedCandidates, ...discoveredCandidates].sort(
    (left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title)
  );

  await writeDynamicContextRegistryEntries(
    context.outputPath,
    candidates.map((candidate) => candidate.entry)
  );
  await writeJsonEnsured(cachePath, {
    generatedAt: new Date().toISOString(),
    limit,
    bucketId: options.bucketId ?? "all",
    seedOnly,
    curatedSeedCount: seedCandidates.length,
    discoveredCount: discoveredCandidates.length,
    candidates,
    notes
  });
  await writeFileEnsured(
    reportPath,
    `# Ecosystem Radar

## Run

- Repository: ${context.repoName}
- Output: ${context.outputPath}
- Seed only: ${seedOnly ? "yes" : "no"}
- Bucket filter: ${options.bucketId ?? "all"}
- Additional discovery limit: ${limit}
- Materialized entries: ${candidates.length}
- Curated seeds: ${seedCandidates.length}
- Discovered candidates: ${discoveredCandidates.length}

## Notes

${renderList(notes)}

## Curated Seeds

${seedCandidates.length > 0 ? seedCandidates.map((candidate) => renderCandidate(candidate)).join("\n") : "- None"}

## Discovered Candidates

${discoveredCandidates.length > 0 ? discoveredCandidates.map((candidate) => renderCandidate(candidate)).join("\n") : "- None"}
`
  );

  return {
    context,
    reportPath,
    cachePath,
    candidates,
    notes
  };
}
