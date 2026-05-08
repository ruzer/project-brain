import path from "node:path";

import { readJsonSafe, readTextSafe, uniqueSorted, writeFileEnsured } from "../../shared/fs-utils";
import type { ContextLiteResult, DiscoveryResult, ProjectContext } from "../../shared/types";

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
}

interface RepoMetadata {
  readmeSummary?: string;
  scripts: string[];
}

interface FrontendSignals {
  routeFiles: string[];
  layoutFiles: string[];
  pageFiles: string[];
  componentRoots: string[];
  componentFiles: string[];
  renderingStrategy?: string;
  i18nSignals: string[];
  stateSignals: string[];
  dataFetchingSignals: string[];
  uiSignals: string[];
  adminSignals: string[];
}

interface BackendSignals {
  routeFiles: string[];
  endpointExamples: string[];
  contractFiles: string[];
  authSignals: string[];
  validationSignals: string[];
  dataSignals: string[];
  queueSignals: string[];
  webhookSignals: string[];
  integrationSignals: string[];
}

interface NavigationSignals {
  navFiles: string[];
  navLabels: string[];
  navSectionLabels: string[];
  actorScopes: string[];
  guardFiles: string[];
  guardSummaries: string[];
  permissionFiles: string[];
}

interface ModuleSignal {
  label: string;
  files: string[];
  status: "active" | "legacy" | "fallback";
  note: string;
}

interface DocumentationInsight {
  filePath: string;
  title: string;
  domainKey?: string;
  summary?: string;
  actorHighlights: string[];
  ruleHighlights: string[];
  flowHighlights: string[];
  decisionHighlights: string[];
  pendingNotes: string[];
}

interface DomainInventoryEntry {
  label: string;
  docFiles: string[];
  codeFiles: string[];
  highlights: string[];
}

interface SourceAuthoritySignals {
  primarySources: string[];
  secondarySources: string[];
  declaredCanonicalSources: string[];
  authorityNotes: string[];
  ambiguousSources: string[];
  notes: string[];
}

interface DocumentationSignals {
  docFiles: string[];
  insights: DocumentationInsight[];
  domainEntries: DomainInventoryEntry[];
  actorEntries: string[];
  ruleEntries: string[];
  flowEntries: string[];
  decisionEntries: string[];
  pending: string[];
  summary: string[];
  authority: SourceAuthoritySignals;
}

interface ContextLiteDocumentSet {
  systemOverview: string;
  domainInventory: string;
  modulesMap: string;
  frontendArchitecture: string;
  backendFlowsAndContracts: string;
  uiRules: string;
  masterContextPrompt: string;
  decisionsBlock: string;
  learningsBlock: string;
  tasksBlock: string;
  summary: string[];
  openQuestions: string[];
}

const GENERATED_START = "<!-- context-lite:generated:start -->";
const GENERATED_END = "<!-- context-lite:generated:end -->";

const UI_DEPENDENCY_MAP = new Map<string, string>([
  ["tailwindcss", "Tailwind CSS"],
  ["@radix-ui/", "Radix UI"],
  ["@mui/", "Material UI"],
  ["@chakra-ui/", "Chakra UI"],
  ["antd", "Ant Design"],
  ["bootstrap", "Bootstrap"],
  ["styled-components", "styled-components"],
  ["@emotion/", "Emotion"],
  ["shadcn", "shadcn/ui"]
]);

const STATE_DEPENDENCY_MAP = new Map<string, string>([
  ["zustand", "Zustand"],
  ["redux", "Redux"],
  ["@reduxjs/toolkit", "Redux Toolkit"],
  ["jotai", "Jotai"],
  ["mobx", "MobX"]
]);

const DATA_FETCHING_DEPENDENCY_MAP = new Map<string, string>([
  ["@tanstack/react-query", "TanStack Query"],
  ["react-query", "React Query"],
  ["swr", "SWR"],
  ["apollo", "Apollo"],
  ["urql", "urql"]
]);

const I18N_DEPENDENCY_MAP = new Map<string, string>([
  ["i18next", "i18next"],
  ["react-i18next", "react-i18next"],
  ["next-intl", "next-intl"],
  ["next-i18next", "next-i18next"]
]);

const AUTH_DEPENDENCY_MAP = new Map<string, string>([
  ["next-auth", "NextAuth"],
  ["@auth/", "Auth.js"],
  ["clerk", "Clerk"],
  ["auth0", "Auth0"],
  ["lucia", "Lucia"],
  ["passport", "Passport"],
  ["jsonwebtoken", "JWT"],
  ["express-session", "Express session"]
]);

const VALIDATION_DEPENDENCY_MAP = new Map<string, string>([
  ["zod", "Zod"],
  ["yup", "Yup"],
  ["joi", "Joi"],
  ["ajv", "AJV"],
  ["class-validator", "class-validator"],
  ["pydantic", "Pydantic"]
]);

const DATA_DEPENDENCY_MAP = new Map<string, string>([
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle"],
  ["typeorm", "TypeORM"],
  ["sequelize", "Sequelize"],
  ["mongoose", "Mongoose"],
  ["knex", "Knex"],
  ["supabase", "Supabase"],
  ["firebase", "Firebase"]
]);

const QUEUE_DEPENDENCY_MAP = new Map<string, string>([
  ["bullmq", "BullMQ"],
  ["bull", "Bull"],
  ["agenda", "Agenda"],
  ["pg-boss", "pg-boss"],
  ["kafkajs", "KafkaJS"],
  ["amqplib", "AMQP"]
]);

const DOCUMENT_EXTENSIONS = /\.(md|mdx|txt)$/i;
const ACTOR_KEYWORDS = [
  "admin",
  "administrator",
  "operator",
  "moderator",
  "manager",
  "user",
  "customer",
  "client",
  "member",
  "vendor",
  "merchant",
  "seller",
  "business",
  "guide",
  "owner",
  "staff",
  "guest",
  "public"
];
const NAVIGATION_SCOPE_MAP = new Map<string, string>([
  ["admin", "admin"],
  ["administrator", "admin"],
  ["moderator", "moderator"],
  ["operator", "operator"],
  ["user", "user"],
  ["customer", "customer"],
  ["vendor", "vendor"],
  ["business", "business"],
  ["guide", "guide"],
  ["creator", "creator"],
  ["public", "public"]
]);
const DOMAIN_SURFACE_GENERIC_TOKENS = new Set([
  "dashboard",
  "system",
  "module",
  "feature",
  "features",
  "technical",
  "engineering",
  "current",
  "final",
  "manual",
  "testing",
  "tests",
  "global",
  "public",
  "private",
  "admin"
]);
const DOMAIN_ALIAS_MAP = new Map<string, string[]>([
  ["access-control", ["access", "auth", "permission", "permissions", "session", "role", "roles", "rbac", "acl", "guard", "login"]],
  ["authentication", ["auth", "login", "session", "token", "identity"]],
  ["authorization", ["auth", "permission", "permissions", "role", "roles", "access", "rbac", "acl", "guard"]],
  ["events", ["event", "events", "registration", "registrations", "announcement", "announcements", "attachment", "attachments", "resource", "resources"]],
  ["profiles", ["profile", "profiles", "guide-profile", "business-profile", "public-profile", "user-profile", "privacy", "username", "certifications"]],
  ["reports", ["report", "reports", "moderation", "flag", "flags"]],
  ["audit", ["audit", "auditlog", "log", "logs", "history"]],
  ["tags", ["tag", "tags"]],
  ["reviews", ["review", "reviews", "rating", "ratings"]],
  ["routes", ["route", "routes", "gpx", "waypoint", "waypoints"]],
  ["community", ["community", "member", "members", "social"]],
  ["explore", ["explore", "featured", "discover"]],
  ["notifications", ["notification", "notifications", "notify", "dispatch", "message", "messages", "inbox"]],
  ["vendor-dashboard", ["vendor", "dashboard", "listing", "profile", "service", "services"]],
  ["business-dashboard", ["business", "dashboard", "branch", "branches", "service", "services", "analytics"]],
  ["admin-dashboard", ["admin", "dashboard", "backoffice", "moderation"]],
  ["customer-dashboard", ["customer", "dashboard", "profile", "account"]]
]);
const DOMAIN_STOPWORDS = new Set([
  "docs",
  "doc",
  "readme",
  "feature",
  "features",
  "technical",
  "engineering",
  "api",
  "apis",
  "flow",
  "flows",
  "definition",
  "definitions",
  "decision",
  "decisions",
  "testing",
  "test",
  "tests",
  "verify",
  "verification",
  "audit",
  "final",
  "current",
  "schema",
  "design",
  "manual",
  "status",
  "architecture",
  "app",
  "src",
  "page",
  "layout",
  "route",
  "routes",
  "dashboard",
  "public",
  "components",
  "component"
]);
const NAV_TITLE_STOPWORDS = /\b(sidebar|nav|navigation|menu|topbar|sheet|layout|mobile)\b/i;
const ROOT_OPERATIONAL_DOC_PATTERN = /(^|\/)(README|API|ARCHITECTURE|FLOWS|BUSINESS_RULES)\.(md|mdx|txt)$/i;
const AUTHORITY_SECTION_TITLE_PATTERN =
  /\b(scope(?:\s*&\s*|\s+and\s+)sources?|primary sources?|fuentes primarias?|source of truth|fuente de verdad|authority|canon)\b/i;
const ROOT_SECTION_DOMAIN_MAP: Array<{ pattern: RegExp; domainKey: string }> = [
  { pattern: /^events?$/i, domainKey: "events" },
  { pattern: /^profiles?$/i, domainKey: "profiles" },
  { pattern: /^guide profiles?$/i, domainKey: "profiles" },
  { pattern: /^business profiles?$/i, domainKey: "profiles" },
  { pattern: /^privacy(?:\s*\(.*profiles?\))?$/i, domainKey: "profiles" },
  { pattern: /^public user profile$/i, domainKey: "profiles" },
  { pattern: /^reportes?$/i, domainKey: "reports" },
  { pattern: /^reports?$/i, domainKey: "reports" },
  { pattern: /^auditor[ií]a$/i, domainKey: "audit" },
  { pattern: /^audit$/i, domainKey: "audit" },
  { pattern: /^tags?$/i, domainKey: "tags" },
  { pattern: /^notifications?$/i, domainKey: "notifications" },
  { pattern: /^reviews?$/i, domainKey: "reviews" },
  { pattern: /^routes?$/i, domainKey: "routes" },
  { pattern: /^community$/i, domainKey: "community" },
  { pattern: /^explore$/i, domainKey: "explore" },
  { pattern: /^business(?: dashboard)?$/i, domainKey: "business-dashboard" },
  { pattern: /^academy$/i, domainKey: "academy" },
  { pattern: /^badges?$/i, domainKey: "badges" }
];

function renderList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "- None confirmed";
}

function toEvidence(paths: string[]): string {
  return paths.length > 0 ? ` Evidence: ${paths.map((filePath) => `\`${filePath}\``).join(", ")}.` : "";
}

function sample(items: string[], limit = 5): string[] {
  return items.slice(0, limit);
}

function isGeneratedContextPath(filePath: string): boolean {
  return /^(AI_CONTEXT|reports|memory|tasks)\//i.test(filePath);
}

function sampleSourceEvidence(items: string[], limit = 5): string[] {
  return sample(
    items.filter((filePath) => !isGeneratedContextPath(filePath)),
    limit
  );
}

function uniquePreserved(items: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const item of items) {
    if (!item || seen.has(item)) {
      continue;
    }

    seen.add(item);
    unique.push(item);
  }

  return unique;
}

function flattenDependencies(discovery: DiscoveryResult): string[] {
  return uniqueSorted(discovery.dependencies.flatMap((manifest) => manifest.dependencies));
}

function flattenLowerDependencies(discovery: DiscoveryResult): string[] {
  return flattenDependencies(discovery).map((dependency) => dependency.toLowerCase());
}

function matchingDependencies(flatDependencies: string[], mapping: Map<string, string>): string[] {
  const matches = new Set<string>();

  for (const dependency of flatDependencies) {
    for (const [needle, label] of mapping.entries()) {
      if (dependency.includes(needle)) {
        matches.add(label);
      }
    }
  }

  return [...matches].sort((left, right) => left.localeCompare(right));
}

function matchingFiles(discovery: DiscoveryResult, pattern: RegExp, limit = 20): string[] {
  return discovery.files.filter((filePath) => pattern.test(filePath)).slice(0, limit);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeDocText(value: string): string {
  return value
    .replace(/\[(.*?)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function humanizeLabel(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function tokenizeSearchTerms(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3 && !DOMAIN_STOPWORDS.has(token));
}

function countMatchedDomainTokens(filePath: string, tokens: string[]): { specific: number; generic: number } {
  let specific = 0;
  let generic = 0;
  const searchablePath = filePath.replace(/([a-z0-9])([A-Z])/g, "$1-$2");

  for (const token of tokens) {
    if (
      token === "route" &&
      /\/route\.(ts|tsx|js|jsx)$/i.test(searchablePath) &&
      !/(^|[\\/()_.-])routes([\\/()_.-]|$)/i.test(searchablePath)
    ) {
      continue;
    }

    if (!new RegExp(`(^|[\\\\/()_.-])${escapeRegExp(token)}([\\\\/()_.-]|$)`, "i").test(searchablePath)) {
      continue;
    }

    if (DOMAIN_SURFACE_GENERIC_TOKENS.has(token)) {
      generic += 1;
    } else {
      specific += 1;
    }
  }

  return { specific, generic };
}

function scoreDomainSurface(filePath: string, tokens: string[], domainLabel?: string): number {
  if (/^(AI_CONTEXT|reports|memory|tasks)\//i.test(filePath) || /(^|\/)(docs|doc)\//i.test(filePath)) {
    return -100;
  }

  if (/\.(md|mdx|txt)$/i.test(filePath)) {
    return -60;
  }

  const matches = countMatchedDomainTokens(filePath, tokens);
  const hasSpecificTokenSet = tokens.some((token) => !DOMAIN_SURFACE_GENERIC_TOKENS.has(token));
  if (matches.specific === 0 && matches.generic === 0) {
    return -100;
  }
  if (hasSpecificTokenSet && matches.specific === 0) {
    return -100;
  }

  let score = matches.specific * 10 + matches.generic * 3;

  if (/(^|\/)(app\/src|src)\/app\/api\/.+\/route\.(ts|tsx|js|jsx)$/i.test(filePath)) {
    score += 16;
  }
  if (/(^|\/)(app\/src|src)\/app\/.+\/(page|layout)\.(ts|tsx|js|jsx|mdx)$/i.test(filePath)) {
    score += 14;
  }
  if (/(^|\/)(app\/src|src)\/(components|lib|services|modules|actions|hooks|features)\//i.test(filePath)) {
    score += 12;
  }
  if (/(^|\/)(app\/src|src)\/(app|components|lib|services|modules|actions|hooks|features)\//i.test(filePath)) {
    score += 8;
  }
  if (/(^|\/)app\/prisma\/schema\.prisma$/i.test(filePath)) {
    score += 5;
  }
  if (/\.(ts|tsx|js|jsx)$/i.test(filePath)) {
    score += 4;
  }
  if (/\.(prisma|sql)$/i.test(filePath)) {
    score += 1;
  }

  if (/(^|\/)(tests?|spec)\//i.test(filePath)) {
    score -= 6;
  }
  if (/(^|\/)(scripts?)\//i.test(filePath)) {
    score -= 5;
  }
  if (/(^|\/)app\/prisma\/migrations\//i.test(filePath)) {
    score -= 6;
  }
  if (/(^|\/)app\/prisma\/seeds?\//i.test(filePath)) {
    score -= 5;
  }
  if (/(^|\/)app\/backups\//i.test(filePath)) {
    score -= 12;
  }
  if (/\.(json|ya?ml)$/i.test(filePath)) {
    score -= 8;
  }

  if (domainLabel === "profiles") {
    if (/(^|\/)(app\/src|src)\/app\/api\/profile\/(guide|business|public)\/route\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      score += 30;
    }
    if (/(^|\/)(app\/src|src)\/app\/api\/profile\/(guide|business)\/(activate|status|update)\/route\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      score += 28;
    }
    if (/(^|\/)(app\/src|src)\/app\/api\/profile\//i.test(filePath)) {
      score += 24;
    }
    if (/(^|\/)(app\/src|src)\/app\/api\/users\/\[username\]\/public\/route\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      score += 22;
    }
    if (/(^|\/)(app\/src|src)\/services\/(guide|business).*profile.*service\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      score += 20;
    }
    if (/(^|\/)(app\/src|src)\/services\/public.*profile.*service\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      score += 20;
    }
    if (/(^|\/)(app\/src|src)\/components\/(guide|business|user|profile)\/.*profile/i.test(filePath)) {
      score += 20;
    }
    if (/(^|\/)(app\/src|src)\/components\/profile\//i.test(filePath)) {
      score += 18;
    }
    if (/(^|\/)(app\/src|src)\/app\/.+\/(profile|public-profile|privacy)\/page\.(ts|tsx|js|jsx|mdx)$/i.test(filePath)) {
      score += 18;
    }
    if (/(^|\/)(app\/src|src)\/app\/.+\/u\/\[username\]\/page\.(ts|tsx|js|jsx|mdx)$/i.test(filePath)) {
      score += 18;
    }
    if (/(^|\/)(app\/src|src)\/app\/.+\/profiles\//i.test(filePath)) {
      score += 14;
    }
    if (/(^|\/)(app\/src|src)\/(app\/components|components)\/routes?\//i.test(filePath)) {
      score -= 18;
    }
    if (/(^|\/)(app\/src|src)\/(components|app\/components)\/admin\//i.test(filePath) && !/profile/i.test(filePath)) {
      score -= 10;
    }
    if (/(^|\/)(app\/src|src)\/lib\/auth\//i.test(filePath) && !/profile/i.test(filePath)) {
      score -= 8;
    }
  }

  return score;
}

function pickBalancedDomainFiles(candidates: Array<{ filePath: string; score: number }>, limit: number): string[] {
  const selected: string[] = [];
  const seenGroups = new Set<string>();

  for (const candidate of candidates) {
    const group = inferPrimarySurfaceGroup(candidate.filePath);
    if (seenGroups.has(group)) {
      continue;
    }
    selected.push(candidate.filePath);
    seenGroups.add(group);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const candidate of candidates) {
    if (selected.includes(candidate.filePath)) {
      continue;
    }
    selected.push(candidate.filePath);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function parseReadmeSummary(content: string): string | undefined {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"));

  return lines[0] ? lines[0].replace(/\s+/g, " ").trim() : undefined;
}

async function loadRepoMetadata(context: ProjectContext): Promise<RepoMetadata> {
  const packageJson = await readJsonSafe<PackageJsonShape>(path.join(context.targetPath, "package.json"));
  const readme =
    (await readTextSafe(path.join(context.targetPath, "README.md"))) ||
    (await readTextSafe(path.join(context.targetPath, "README.mdx"))) ||
    (await readTextSafe(path.join(context.targetPath, "README.txt")));

  return {
    readmeSummary: parseReadmeSummary(readme),
    scripts: Object.keys(packageJson?.scripts ?? {}).sort((left, right) => left.localeCompare(right))
  };
}

function inferActorScopesFromPath(filePath: string): string[] {
  const lowerPath = filePath.toLowerCase();
  const scopes = new Set<string>();

  for (const [needle, label] of NAVIGATION_SCOPE_MAP.entries()) {
    if (lowerPath.includes(needle)) {
      scopes.add(label);
    }
  }

  return [...scopes].sort((left, right) => left.localeCompare(right));
}

function inferPrimarySurfaceGroup(filePath: string): string {
  const normalized = filePath.toLowerCase();

  if (normalized.includes("dashboard-root")) {
    return "dashboard-root";
  }
  if (normalized.includes("(dashboard-user)") || normalized.includes("/user/")) {
    return "user";
  }
  if (normalized.includes("(dashboard-business)") || normalized.includes("/business/")) {
    return "business";
  }
  if (normalized.includes("(dashboard-guide)") || normalized.includes("/guide/")) {
    return "guide";
  }
  if (normalized.includes("(dashboard-creator)") || normalized.includes("/creator/")) {
    return "creator";
  }
  if (normalized.includes("(dashboard-admin)") || normalized.includes("/admin/")) {
    return "admin";
  }
  if (normalized.includes("(public)") || normalized.includes("public")) {
    return "public";
  }
  if (normalized.includes("(auth)") || normalized.includes("/auth/")) {
    return "auth";
  }
  if (/(topbar|footer|bottomnav|navsheet|switcher|shell)/i.test(filePath)) {
    return "shared-shell";
  }

  return inferActorScopesFromPath(filePath)[0] ?? "general";
}

function scoreRepresentativeSurface(filePath: string): number {
  let score = 0;

  if (/dashboard-root/i.test(filePath)) {
    score += 20;
  }
  if (/\(dashboard-user\)|\/user\//i.test(filePath)) {
    score += 18;
  }
  if (/\(dashboard-business\)|\/business\//i.test(filePath)) {
    score += 17;
  }
  if (/\(dashboard-guide\)|\/guide\//i.test(filePath)) {
    score += 16;
  }
  if (/\(dashboard-creator\)|\/creator\//i.test(filePath)) {
    score += 15;
  }
  if (/\(dashboard-admin\)|\/admin\//i.test(filePath)) {
    score += 14;
  }
  if (/\(public\)|public/i.test(filePath)) {
    score += 13;
  }
  if (/\(auth\)|\/auth\//i.test(filePath)) {
    score += 12;
  }
  if (/(Topbar|Footer|BottomNav|NavSheet|Switcher|Shell)/i.test(filePath)) {
    score += 11;
  }
  if (/(Sidebar|Navigation|NavConfig|navConfig|Menu|MobileNav)/i.test(filePath)) {
    score += 8;
  }
  if (/\/layout\.(ts|tsx|js|jsx|mdx)$/i.test(filePath)) {
    score += 6;
  }
  if (/\/page\.(ts|tsx|js|jsx|mdx)$/i.test(filePath)) {
    score += 5;
  }

  return score;
}

function pickRepresentativeFiles(files: string[], limit: number): string[] {
  const sorted = uniqueSorted(files).sort(
    (left, right) => scoreRepresentativeSurface(right) - scoreRepresentativeSurface(left) || left.localeCompare(right)
  );
  const selected: string[] = [];
  const seenGroups = new Set<string>();

  for (const filePath of sorted) {
    const group = inferPrimarySurfaceGroup(filePath);
    if (seenGroups.has(group)) {
      continue;
    }
    selected.push(filePath);
    seenGroups.add(group);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const filePath of sorted) {
    if (selected.includes(filePath)) {
      continue;
    }
    selected.push(filePath);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

function normalizeNavLabel(value: string): string | undefined {
  const normalized = normalizeDocText(value).replace(/^[/:.-]+|[/:.-]+$/g, "").trim();
  if (!normalized || normalized.length < 2 || normalized.length > 48) {
    return undefined;
  }

  if (/^\/|^[A-Z0-9_/-]+$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

async function detectNavigationSignals(context: ProjectContext): Promise<NavigationSignals> {
  const navFiles = uniqueSorted([
    ...matchingFiles(context.discovery, /(^|\/).*(Sidebar|Topbar|Footer|BottomNav|NavSheet|Switcher|Shell|Nav|Navigation|Menu|NavConfig|navConfig|MobileNav).*\.(ts|tsx|js|jsx)$/i, 40),
    ...matchingFiles(context.discovery, /(^|\/).*(sidebar|topbar|footer|bottomnav|navsheet|switcher|shell|nav|navigation|menu).*\.(ts|tsx|js|jsx)$/i, 40)
  ]).slice(0, 30);
  const guardFiles = uniqueSorted([
    ...matchingFiles(context.discovery, /(^|\/)(src\/)?app\/.+\/layout\.(ts|tsx|js|jsx)$/i, 20),
    ...matchingFiles(context.discovery, /(^|\/)(auth|session|permissions?|roles?|access|acl|rbac).*\.(ts|tsx|js|jsx)$/i, 20)
  ]).slice(0, 30);
  const permissionFiles = uniqueSorted(
    matchingFiles(context.discovery, /(^|\/).*(permissions?|roles?|access|acl|rbac).*\.(ts|tsx|js|jsx)$/i, 20)
  );
  const navLabels = new Set<string>();
  const navSectionLabels = new Set<string>();
  const actorScopes = new Set<string>();
  const guardSummaries = new Set<string>();

  for (const filePath of navFiles) {
    for (const scope of inferActorScopesFromPath(filePath)) {
      actorScopes.add(scope);
    }

    const content = await readTextSafe(path.join(context.targetPath, filePath));
    if (!content) {
      continue;
    }

    for (const match of content.matchAll(/\b(label|title|name)\s*:\s*["'`]([^"'`]+)["'`]/g)) {
      const field = String(match[1]).toLowerCase();
      const label = normalizeNavLabel(String(match[2]));
      if (!label) {
        continue;
      }

      if (field === "title" || NAV_TITLE_STOPWORDS.test(label)) {
        navSectionLabels.add(label);
      } else {
        navLabels.add(label);
      }
    }
  }

  for (const filePath of guardFiles) {
    for (const scope of inferActorScopesFromPath(filePath)) {
      actorScopes.add(scope);
    }

    const content = await readTextSafe(path.join(context.targetPath, filePath));
    if (!content) {
      continue;
    }

    const facts: string[] = [];
    if (/redirect\(\s*["'`][^"'`]+["'`]\s*\)/.test(content)) {
      facts.push("redirect");
    }
    if (/\b(getCurrentUser|getSession|requireAuth|useAuth)\b/.test(content)) {
      facts.push("session");
    }
    if (/\b(hasPermission|requirePermission|permissions?\b|CAN_[A-Z_]+|roleRelation)\b/.test(content)) {
      facts.push("permission-check");
    }
    if (/\b(requireRole|user\.role\b|roles\b|role\b)\b/.test(content)) {
      facts.push("role-check");
    }
    if (/\b(can[A-Z][A-Za-z]+|guideProfile|businessProfile|status\s*===\s*["'`]APPROVED["'`]|profileVisible)\b/.test(content)) {
      facts.push("capability-check");
    }

    if (facts.length > 0) {
      guardSummaries.add(`${filePath}: ${uniqueSorted(facts).join(", ")}`);
    }
  }

  return {
    navFiles,
    navLabels: [...navLabels].sort((left, right) => left.localeCompare(right)).slice(0, 12),
    navSectionLabels: [...navSectionLabels].sort((left, right) => left.localeCompare(right)).slice(0, 8),
    actorScopes: [...actorScopes].sort((left, right) => left.localeCompare(right)),
    guardFiles: guardFiles.slice(0, 12),
    guardSummaries: [...guardSummaries].sort((left, right) => left.localeCompare(right)).slice(0, 10),
    permissionFiles
  };
}

function documentationCandidateFiles(discovery: DiscoveryResult): string[] {
  return uniqueSorted(
    discovery.files.filter(
      (filePath) =>
        !/^(AI_CONTEXT|reports|memory|tasks)\//i.test(filePath) &&
        DOCUMENT_EXTENSIONS.test(filePath) &&
        (/^README\.(md|mdx|txt)$/i.test(path.basename(filePath)) ||
          /(^|\/)(docs|doc)\//i.test(filePath) ||
          /(^|\/)(API|ARCHITECTURE|FLOWS|BUSINESS_RULES)\.(md|mdx|txt)$/i.test(filePath) ||
          /(^|\/)(SECURITY|CONTRIBUTING|CHANGELOG)\.(md|mdx|txt)$/i.test(filePath) ||
          /\/README\.(md|mdx|txt)$/i.test(filePath))
    )
  ).slice(0, 80);
}

function extractParagraphs(content: string): string[] {
  const paragraphs: string[] = [];
  const lines = content.split(/\r?\n/);
  let current: string[] = [];
  let inCodeBlock = false;

  const flush = () => {
    if (current.length === 0) {
      return;
    }

    const normalized = normalizeDocText(current.join(" "));
    if (normalized) {
      paragraphs.push(normalized);
    }
    current = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      flush();
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (!line) {
      flush();
      continue;
    }

    if (/^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^\|/.test(line)) {
      flush();
      continue;
    }

    current.push(line);
  }

  flush();
  return paragraphs;
}

function extractBulletLines(content: string): string[] {
  return uniquePreserved(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line))
      .map((line) => normalizeDocText(line.replace(/^[-*]\s+|^\d+[.)]\s+/, "")))
      .filter(Boolean)
  );
}

function extractHeadingLines(content: string): string[] {
  return uniquePreserved(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^#{1,6}\s+/.test(line))
      .map((line) => normalizeDocText(line.replace(/^#{1,6}\s+/, "")))
      .filter(Boolean)
  );
}

function extractHeadingSections(content: string): Array<{ title: string; level: number; body: string }> {
  const sections: Array<{ title: string; level: number; body: string }> = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!match) {
      continue;
    }

    const level = match[1].length;
    const title = normalizeDocText(match[2] ?? "");
    if (!title) {
      continue;
    }

    const bodyLines: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextMatch = lines[cursor]?.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (nextMatch && nextMatch[1].length <= level) {
        break;
      }
      bodyLines.push(lines[cursor] ?? "");
    }

    sections.push({
      title,
      level,
      body: bodyLines.join("\n").trim()
    });
  }

  return sections;
}

function inferRootSectionDomainKey(title: string): string | undefined {
  for (const entry of ROOT_SECTION_DOMAIN_MAP) {
    if (entry.pattern.test(title.trim())) {
      return entry.domainKey;
    }
  }

  return undefined;
}

function extractStatusNote(filePath: string, content: string): string | undefined {
  const line = content
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => /(?:\*\*)?(estado|status)(?:\*\*)?\s*:/.test(entry.toLowerCase()));

  if (!line) {
    return undefined;
  }

  const [, value = ""] = line.split(/:/, 2);
  const normalized = normalizeDocText(value);
  if (!normalized) {
    return undefined;
  }

  if (/(draft|borrador|pendiente|wip|proposed|todo)/i.test(normalized)) {
    return `\`${filePath}\` está marcado como ${normalized}.`;
  }

  return undefined;
}

function inferDomainKeyFromDocPath(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  let match = normalized.match(/^docs\/([^/]+)\//i);
  if (match?.[1]) {
    return toSlug(match[1]);
  }

  match = normalized.match(/^app\/docs\/FEATURES\/([^/]+)\.(md|mdx|txt)$/i);
  if (match?.[1]) {
    return toSlug(match[1]);
  }

  match = normalized.match(/^app\/docs\/technical\/([^/]+)\.(md|mdx|txt)$/i);
  if (match?.[1]) {
    return toSlug(match[1]);
  }

  match = normalized.match(/^app\/docs\/([^/]+)\//i);
  if (match?.[1] && !/^(technical|features)$/i.test(match[1])) {
    return toSlug(match[1]);
  }

  if (/\/README\.(md|mdx|txt)$/i.test(normalized)) {
    const parentDir = path.basename(path.dirname(normalized));
    if (parentDir && !/^(docs|app)$/i.test(parentDir)) {
      return toSlug(parentDir);
    }
  }

  return undefined;
}

function extractActorHighlights(headings: string[], bullets: string[], paragraphs: string[]): string[] {
  const actorPattern = new RegExp(`\\b(${ACTOR_KEYWORDS.join("|")})\\b`, "i");
  const allowParagraphs = headings.some((entry) => /\b(actor|actors|roles|actores|alcance)\b/i.test(entry));
  if (!allowParagraphs) {
    return [];
  }

  const isEndpointLike = (entry: string): boolean =>
    /^(get|post|put|patch|delete)\b/i.test(entry) ||
    /\/api\//i.test(entry) ||
    (/\b(api|endpoint)\b/i.test(entry) && entry.includes("/"));

  const actorHeadings = headings.filter(
    (entry) =>
      actorPattern.test(entry) &&
      entry.split(/\s+/).length <= 3 &&
      !isEndpointLike(entry) &&
      !/[():]/.test(entry) &&
      !/\b(decision|decisions|definition|principles|objectives|states|rules|overview|summary|dashboard|module|profile|system|portal)\b/i.test(entry)
  );
  const shortBulletLabels = bullets.filter(
    (entry) =>
      actorPattern.test(entry) &&
      entry.length <= 32 &&
      !isEndpointLike(entry) &&
      !/[.!?():]/.test(entry) &&
      entry.split(/\s+/).length <= 3
  );
  const candidates = [...actorHeadings, ...shortBulletLabels];
  return uniquePreserved(
    candidates.filter((entry) => actorPattern.test(entry) && entry.length <= 40 && !isEndpointLike(entry))
  ).slice(0, 6);
}

function collectKeywordHighlights(
  descriptor: string,
  bullets: string[],
  paragraphs: string[],
  keywords: string[]
): string[] {
  const lowerDescriptor = descriptor.toLowerCase();
  const pattern = new RegExp(`\\b(${keywords.map((keyword) => escapeRegExp(keyword)).join("|")})\\b`, "i");
  const preferred = [...bullets, ...paragraphs].filter((entry) => pattern.test(entry));

  if (preferred.length > 0) {
    return uniquePreserved(preferred).slice(0, 4);
  }

  if (keywords.some((keyword) => lowerDescriptor.includes(keyword.toLowerCase()))) {
    return uniquePreserved([...bullets, ...paragraphs]).slice(0, 4);
  }

  return [];
}

function parseDocumentationInsight(filePath: string, content: string): DocumentationInsight {
  const headings = extractHeadingLines(content);
  const bullets = extractBulletLines(content);
  const paragraphs = extractParagraphs(content);
  const title = headings[0] ?? humanizeLabel(path.parse(filePath).name);
  const descriptor = `${filePath} ${title} ${headings.join(" ")}`;

  return {
    filePath,
    title,
    domainKey: inferDomainKeyFromDocPath(filePath),
    summary: paragraphs[0],
    actorHighlights: extractActorHighlights(headings, bullets, paragraphs),
    ruleHighlights: collectKeywordHighlights(descriptor, bullets, paragraphs, [
      "rule",
      "regla",
      "principle",
      "principio",
      "state",
      "estado",
      "error",
      "access",
      "scope",
      "permission",
      "policy"
    ]),
    flowHighlights: collectKeywordHighlights(descriptor, bullets, paragraphs, [
      "flow",
      "flujo",
      "workflow",
      "journey",
      "step",
      "activation"
    ]),
    decisionHighlights: collectKeywordHighlights(descriptor, bullets, paragraphs, [
      "decision",
      "decisiones",
      "why",
      "por qué",
      "default",
      "optional"
    ]),
    pendingNotes: extractStatusNote(filePath, content) ? [extractStatusNote(filePath, content) as string] : []
  };
}

function parseSyntheticDomainInsights(filePath: string, content: string): DocumentationInsight[] {
  if (!ROOT_OPERATIONAL_DOC_PATTERN.test(filePath)) {
    return [];
  }

  const sections = extractHeadingSections(content);

  return sections.flatMap((section) => {
    const domainKey = inferRootSectionDomainKey(section.title);
    if (!domainKey) {
      return [];
    }

    const headings = [section.title, ...extractHeadingLines(section.body)];
    const bullets = extractBulletLines(section.body);
    const paragraphs = extractParagraphs(section.body);

    return [
      {
        filePath,
        title: section.title,
        domainKey,
        summary: paragraphs[0] ?? bullets[0],
        actorHighlights: extractActorHighlights(headings, bullets, paragraphs),
        ruleHighlights: collectKeywordHighlights(`${filePath} ${section.title}`, bullets, paragraphs, [
          "rule",
          "regla",
          "policy",
          "permission",
          "state",
          "status"
        ]),
        flowHighlights: collectKeywordHighlights(`${filePath} ${section.title}`, bullets, paragraphs, [
          "flow",
          "flujo",
          "workflow",
          "step",
          "draft",
          "publish",
          "registration"
        ]),
        decisionHighlights: collectKeywordHighlights(`${filePath} ${section.title}`, bullets, paragraphs, [
          "decision",
          "default",
          "fallback",
          "must",
          "debe"
        ]),
        pendingNotes: []
      }
    ];
  });
}

function extractPathLikeReferences(content: string): string[] {
  return uniquePreserved(
    [...content.matchAll(/`([^`]+)`/g)]
      .map((match) => normalizeDocText(match[1] ?? ""))
      .filter((reference) => Boolean(reference) && (/[\\/]/.test(reference) || /\*/.test(reference) || /\.[a-z0-9]+$/i.test(reference)))
  );
}

function extractAuthorityReferenceBlocks(content: string): string[] {
  const blocks: string[] = [];
  const sections = extractHeadingSections(content)
    .filter((section) => AUTHORITY_SECTION_TITLE_PATTERN.test(section.title))
    .map((section) => section.body);

  blocks.push(...sections);

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\b(primary sources?|fuentes primarias?|source of truth)\b/i.test(lines[index] ?? "")) {
      continue;
    }
    blocks.push(lines.slice(index, index + 12).join("\n"));
  }

  return uniquePreserved(blocks.filter(Boolean));
}

function normalizeDeclaredSourceReference(reference: string, discovery: DiscoveryResult): string | undefined {
  const cleaned = reference.trim().replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleaned || /^(get|post|put|patch|delete)\b/i.test(cleaned)) {
    return undefined;
  }

  const variations = new Set<string>([cleaned]);

  if (!cleaned.startsWith("app/")) {
    variations.add(`app/${cleaned}`);
  }
  if (cleaned.startsWith("src/")) {
    variations.add(`app/${cleaned}`);
  }
  if (cleaned.startsWith("prisma/")) {
    variations.add(`app/${cleaned}`);
  }
  if (cleaned.startsWith("app/src/")) {
    variations.add(cleaned.replace(/^app\//, ""));
  }
  if (cleaned.startsWith("app/prisma/")) {
    variations.add(cleaned.replace(/^app\//, ""));
  }

  for (const candidate of variations) {
    const isGlob = candidate.endsWith("/*");
    const prefix = isGlob ? candidate.slice(0, -1) : candidate;

    if (isGlob) {
      if (discovery.files.some((filePath) => filePath.startsWith(prefix))) {
        return candidate;
      }
      continue;
    }

    if (discovery.files.includes(candidate)) {
      return candidate;
    }

    if (!/\.[a-z0-9]+$/i.test(candidate) && discovery.files.some((filePath) => filePath.startsWith(`${candidate}/`))) {
      return `${candidate}/*`;
    }
  }

  return undefined;
}

function extractDeclaredCanonicalSignals(
  candidates: Array<{ filePath: string; content: string }>,
  discovery: DiscoveryResult
): { sources: string[]; notes: string[] } {
  const sources = new Set<string>();
  const notes = new Set<string>();

  for (const candidate of candidates) {
    if (!/\.mdx?$/i.test(candidate.filePath)) {
      continue;
    }

    const authorityBlocks = extractAuthorityReferenceBlocks(candidate.content);

    const references = uniquePreserved(
      authorityBlocks.flatMap((block) => extractPathLikeReferences(block))
    )
      .map((reference) => normalizeDeclaredSourceReference(reference, discovery))
      .filter((reference): reference is string => Boolean(reference));

    for (const reference of references) {
      sources.add(reference);
    }

    if (/rules below are extracted from live code only|live code only|c[oó]digo vivo|comportamiento real/i.test(candidate.content)) {
      notes.add(`\`${candidate.filePath}\` declara que la referencia principal es el código vivo o el comportamiento real.`);
    }

    if (references.length > 0 && /(primary sources?|fuentes primarias?|source of truth)/i.test(candidate.content)) {
      notes.add(`\`${candidate.filePath}\` declara fuentes canónicas: ${references.map((reference) => `\`${reference}\``).join(", ")}.`);
    }

  }

  return {
    sources: uniqueSorted([...sources]).slice(0, 8),
    notes: uniqueSorted([...notes]).slice(0, 8)
  };
}

function scoreAuthoritySource(filePath: string, content: string): number {
  let score = 0;
  const normalized = filePath.replace(/\\/g, "/");

  if (/^app\/docs\/README\.(md|mdx|txt)$/i.test(normalized)) {
    score = 100;
  } else if (/^app\/API\.(md|mdx|txt)$/i.test(normalized)) {
    score = 98;
  } else if (/^app\/BUSINESS_RULES\.(md|mdx|txt)$/i.test(normalized)) {
    score = 97;
  } else if (/^app\/FLOWS\.(md|mdx|txt)$/i.test(normalized)) {
    score = 96;
  } else if (/^app\/docs\/technical\/ACCESS_CONTROL\.(md|mdx|txt)$/i.test(normalized)) {
    score = 95;
  } else if (/^app\/ARCHITECTURE\.(md|mdx|txt)$/i.test(normalized)) {
    score = 93;
  } else if (/^docs\/[^/]+\/(api|flows|decisions|README)\.(md|mdx|txt)$/i.test(normalized)) {
    score = 90;
  } else if (/^README\.(md|mdx|txt)$/i.test(path.basename(normalized))) {
    score = 82;
  } else if (/schema\.prisma$/i.test(normalized)) {
    score = 72;
  } else if (/\.mdx?$/i.test(normalized)) {
    score = 70;
  }

  if (/Documento alineado al comportamiento real|updated to the real behavior|comportamiento real/i.test(content)) {
    score += 2;
  }
  if (/^app\/ARCHITECTURE\.(md|mdx|txt)$/i.test(normalized) && /\b(runtime architecture|authentication & authorization|service layer)\b/i.test(content)) {
    score += 2;
  }

  return score;
}

function collectAmbiguitySignals(filePath: string, content: string): string[] {
  const notes: string[] = [];

  if (/^<<<<<<<|^=======|^>>>>>>>/m.test(content)) {
    notes.push(`\`${filePath}\` contiene marcadores de conflicto; no tratarlo como fuente única hasta resolverlos.`);
  }

  const statusNote = extractStatusNote(filePath, content);
  if (statusNote) {
    notes.push(statusNote);
  }

  if (/Server Actions?/i.test(content) && /(instead of API routes|adem[aá]s de API routes)/i.test(content)) {
    notes.push(`\`${filePath}\` documenta flujos con Server Actions además de API routes; revisar ambos contratos antes de cambiar backend.`);
  }

  if (/\bSSOT\b|source of truth|fuente de verdad/i.test(content) && /(draft|borrador|wip|pendiente)/i.test(content)) {
    notes.push(`\`${filePath}\` se presenta como fuente de verdad, pero está en draft o pendiente; no tratarlo como canon estable.`);
  }

  if (/double source of truth|doble fuente de verdad/i.test(content)) {
    notes.push(`\`${filePath}\` documenta múltiples fuentes de verdad activas; degradar confianza hasta resolver la duplicidad.`);
  }

  return notes;
}

function buildSourceAuthoritySignals(
  candidates: Array<{ filePath: string; content: string }>,
  discovery: DiscoveryResult
): SourceAuthoritySignals {
  const scored = candidates
    .map((candidate) => ({
      filePath: candidate.filePath,
      score: scoreAuthoritySource(candidate.filePath, candidate.content),
      ambiguities: collectAmbiguitySignals(candidate.filePath, candidate.content)
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

  const primarySources = scored.filter((candidate) => candidate.score >= 95).map((candidate) => candidate.filePath).slice(0, 8);
  const secondarySources = scored
    .filter((candidate) => candidate.score >= 80 && candidate.score < 95)
    .map((candidate) => candidate.filePath)
    .slice(0, 8);
  const declaredCanonical = extractDeclaredCanonicalSignals(candidates, discovery);
  const ambiguousSources = uniqueSorted(scored.flatMap((candidate) => candidate.ambiguities)).slice(0, 8);
  const notes: string[] = [];

  if (declaredCanonical.sources.length > 0) {
    notes.push(`Fuentes canónicas declaradas: ${declaredCanonical.sources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  if (primarySources.length > 0) {
    notes.push(`Fuentes primarias detectadas: ${primarySources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  if (secondarySources.length > 0) {
    notes.push(`Fuentes secundarias útiles: ${secondarySources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  if (declaredCanonical.notes.length > 0) {
    notes.push(...declaredCanonical.notes);
  }
  if (ambiguousSources.length > 0) {
    notes.push(...ambiguousSources);
  }

  return {
    primarySources,
    secondarySources,
    declaredCanonicalSources: declaredCanonical.sources,
    authorityNotes: declaredCanonical.notes,
    ambiguousSources,
    notes
  };
}

function scoreDomainLabel(label: string): number {
  const normalized = label.toLowerCase();
  if (normalized === "events") return 20;
  if (normalized === "reports") return 19;
  if (normalized === "audit") return 18;
  if (normalized === "profiles") return 17;
  if (normalized === "business-dashboard") return 16;
  if (normalized === "notifications") return 15;
  if (normalized === "routes") return 15;
  if (normalized === "academy") return 14;
  if (normalized === "global-map") return 13;
  return 0;
}

function buildDomainSearchTokens(label: string, domainInsights: DocumentationInsight[]): string[] {
  const titleTokens = domainInsights.flatMap((insight) => tokenizeSearchTerms(insight.title));

  if (label === "profiles") {
    return uniqueSorted([
      ...tokenizeSearchTerms(label),
      ...titleTokens.filter((token) => /profile/.test(token)),
      ...(DOMAIN_ALIAS_MAP.get(label) ?? [])
    ]).filter((token) => token.length >= 3);
  }

  return uniqueSorted([
    ...tokenizeSearchTerms(label),
    ...titleTokens,
    ...(DOMAIN_ALIAS_MAP.get(label) ?? [])
  ]).filter((token) => token.length >= 3);
}

function pickRepresentativeDomainLabels(entries: DomainInventoryEntry[], limit: number): string[] {
  return [...entries]
    .sort((left, right) => {
      const scoreDelta = scoreDomainLabel(right.label) - scoreDomainLabel(left.label);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      const docDelta = right.docFiles.length - left.docFiles.length;
      if (docDelta !== 0) {
        return docDelta;
      }
      return left.label.localeCompare(right.label);
    })
    .slice(0, limit)
    .map((entry) => entry.label);
}

function buildDomainEntries(discovery: DiscoveryResult, insights: DocumentationInsight[]): DomainInventoryEntry[] {
  const domainMap = new Map<string, DomainInventoryEntry>();
  const insightMap = new Map<string, DocumentationInsight[]>();

  for (const insight of insights) {
    if (!insight.domainKey) {
      continue;
    }

    const existing = domainMap.get(insight.domainKey) ?? {
      label: insight.domainKey,
      docFiles: [],
      codeFiles: [],
      highlights: []
    };

    existing.docFiles = uniqueSorted([...existing.docFiles, insight.filePath]);
    existing.highlights = uniquePreserved([
      ...existing.highlights,
      insight.summary ?? "",
      ...insight.flowHighlights,
      ...insight.ruleHighlights,
      ...insight.decisionHighlights
    ]).slice(0, 4);

    domainMap.set(insight.domainKey, existing);
    insightMap.set(insight.domainKey, [...(insightMap.get(insight.domainKey) ?? []), insight]);
  }

  for (const entry of domainMap.values()) {
    const domainInsights = insightMap.get(entry.label) ?? [];
    const tokens = buildDomainSearchTokens(entry.label, domainInsights);

    const rankedCandidates = discovery.files
      .filter((filePath) => !/(^|\/)(docs|doc)\//i.test(filePath))
      .map((filePath) => ({
        filePath,
        score: scoreDomainSurface(filePath, tokens, entry.label)
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.filePath.localeCompare(right.filePath));

    entry.codeFiles = pickBalancedDomainFiles(rankedCandidates, 6);
  }

  return [...domainMap.values()].sort((left, right) => left.label.localeCompare(right.label));
}

async function buildDocumentationSignals(context: ProjectContext): Promise<DocumentationSignals> {
  const docFiles = documentationCandidateFiles(context.discovery);
  const insights: DocumentationInsight[] = [];
  const authorityCandidates: Array<{ filePath: string; content: string }> = [];

  for (const filePath of docFiles) {
    const content = await readTextSafe(path.join(context.targetPath, filePath));
    if (!content) {
      continue;
    }

    authorityCandidates.push({ filePath, content });
    insights.push(parseDocumentationInsight(filePath, content));
    insights.push(...parseSyntheticDomainInsights(filePath, content));
  }

  for (const filePath of matchingFiles(context.discovery, /(^|\/)prisma\/schema\.prisma$/i, 4)) {
    const content = await readTextSafe(path.join(context.targetPath, filePath));
    if (!content) {
      continue;
    }
    authorityCandidates.push({ filePath, content });
  }

  const domainEntries = buildDomainEntries(context.discovery, insights);
  const actorEntries = uniquePreserved(
    insights.flatMap((insight) => insight.actorHighlights.map((entry) => `${entry}${toEvidence([insight.filePath])}`))
  ).slice(0, 8);
  const ruleEntries = uniquePreserved(
    insights.flatMap((insight) => insight.ruleHighlights.map((entry) => `${entry}${toEvidence([insight.filePath])}`))
  ).slice(0, 8);
  const flowEntries = uniquePreserved(
    insights.flatMap((insight) => insight.flowHighlights.map((entry) => `${entry}${toEvidence([insight.filePath])}`))
  ).slice(0, 8);
  const decisionEntries = uniquePreserved(
    insights.flatMap((insight) => insight.decisionHighlights.map((entry) => `${entry}${toEvidence([insight.filePath])}`))
  ).slice(0, 8);
  const pending = uniquePreserved(insights.flatMap((insight) => insight.pendingNotes)).slice(0, 8);
  const summary = docFiles.length > 0
    ? [`Documentación estructurada detectada: ${docFiles.slice(0, 6).map((filePath) => `\`${filePath}\``).join(", ")}`]
    : [];
  const authority = buildSourceAuthoritySignals(authorityCandidates, context.discovery);

  return {
    docFiles,
    insights,
    domainEntries,
    actorEntries,
    ruleEntries,
    flowEntries,
    decisionEntries,
    pending,
    summary,
    authority
  };
}

function buildDomainInventoryDocument(documentation: DocumentationSignals): { content: string; pending: string[] } {
  const confirmed: string[] = [];
  const pending: string[] = [...documentation.pending];

  for (const domain of documentation.domainEntries) {
    const notes: string[] = [];
    if (domain.docFiles.length > 0) {
      notes.push(`docs=${domain.docFiles.map((filePath) => `\`${filePath}\``).join(", ")}`);
    }
    if (domain.codeFiles.length > 0) {
      notes.push(`superficies=${domain.codeFiles.map((filePath) => `\`${filePath}\``).join(", ")}`);
    } else {
      pending.push(`El dominio \`${domain.label}\` está documentado, pero no se asociaron superficies de código por heurística.`);
    }
    if (domain.highlights.length > 0) {
      notes.push(`señales=${domain.highlights.map((entry) => `"${entry}"`).join(" | ")}`);
    }

    confirmed.push(`Dominio \`${domain.label}\`: ${notes.join("; ")}`);
  }

  if (documentation.domainEntries.length === 0) {
    confirmed.push("No se detectaron dominios respaldados por documentación; el contexto sigue dependiendo de la estructura del código.");
    if (documentation.docFiles.length === 0) {
      pending.push("No se detectaron `README` o carpetas `docs/` suficientemente estructuradas para extraer dominios operativos.");
    }
  }

  return {
    content: `# Domain Inventory

## Estado actual

${renderList(confirmed)}

## Pendiente de confirmar

${renderList(uniqueSorted(pending))}
`,
    pending: uniqueSorted(pending)
  };
}

function inferProjectShape(discovery: DiscoveryResult): string {
  const frameworks = new Set(discovery.frameworks);
  const hasInternalApiSurface = discovery.files.some((filePath) =>
    /(^|\/)(src\/)?app\/api\/.+\/route\.(ts|tsx|js|jsx)$/i.test(filePath) ||
    /(^|\/)(src\/)?pages\/api\/.+\.(ts|tsx|js|jsx)$/i.test(filePath) ||
    /(^|\/)(routes|controllers)\//i.test(filePath) ||
    /(^|\/)prisma\/schema\.prisma$/i.test(filePath)
  );

  if (
    frameworks.has("NextJS") &&
    (frameworks.has("Express") || frameworks.has("FastAPI") || frameworks.has("NestJS") || hasInternalApiSurface)
  ) {
    return "Full-stack web application";
  }

  if (frameworks.has("NextJS") || frameworks.has("React")) {
    return "Frontend-oriented application";
  }

  if (frameworks.has("Express") || frameworks.has("FastAPI") || frameworks.has("NestJS") || frameworks.has("Spring") || frameworks.has("Rails")) {
    return "Backend/API service";
  }

  if (discovery.infrastructure.length > 0) {
    return "Operational service or infrastructure-backed application";
  }

  return "Software application";
}

function inferSystemGoal(metadata: RepoMetadata, discovery: DiscoveryResult): { confirmed?: string; pending?: string } {
  if (metadata.readmeSummary) {
    return {
      confirmed: `${metadata.readmeSummary}${toEvidence(["README.md"])}`
    };
  }

  if (discovery.frameworks.length > 0 || discovery.apis.length > 0) {
    return {
      confirmed: `${inferProjectShape(discovery)} built around ${discovery.frameworks.join(", ") || "the detected runtime"} and ${discovery.apis.join(", ") || "its current interfaces"}${toEvidence(sampleSourceEvidence([...discovery.manifests, ...discovery.apiFiles, ...discovery.structure.sampleFiles], 4))}`
    };
  }

  return {
    pending: "El objetivo funcional del sistema no está explicitado en README ni en nombres de módulo suficientemente claros."
  };
}

function detectActors(discovery: DiscoveryResult): { confirmed: string[]; pending: string[] } {
  const actors: string[] = [];

  if (discovery.files.some((filePath) => /(^|\/)(admin|backoffice|dashboard)(\/|$)/i.test(filePath))) {
    actors.push(`Operadores o administradores internos${toEvidence(sample(matchingFiles(discovery, /(^|\/)(admin|backoffice|dashboard)(\/|$)/i), 4))}`);
  }

  if (discovery.files.some((filePath) => /(^|\/)(auth|login|signup|account|profile)(\/|$)/i.test(filePath))) {
    actors.push(`Usuarios autenticados${toEvidence(sample(matchingFiles(discovery, /(^|\/)(auth|login|signup|account|profile)(\/|$)/i), 4))}`);
  }

  const publicRouteFiles = uniqueSorted([
    ...matchingFiles(discovery, /(^|\/)(src\/)?app\/\(?public\)?\/.+\/page\.(ts|tsx|js|jsx|mdx)$/i, 4),
    ...matchingFiles(discovery, /(^|\/)(src\/)?app\/\(?public\)?\/page\.(ts|tsx|js|jsx|mdx)$/i, 4),
    ...matchingFiles(discovery, /(^|\/)(src\/)?app\/\(?marketing\)?\/.+\/page\.(ts|tsx|js|jsx|mdx)$/i, 4),
    ...matchingFiles(discovery, /(^|\/)(src\/)?pages\/(index|public|marketing|landing).*\.(ts|tsx|js|jsx|mdx)$/i, 4)
  ]);

  if (publicRouteFiles.length > 0) {
    actors.push(`Usuarios públicos o tráfico anónimo${toEvidence(sample(publicRouteFiles, 4))}`);
  }

  if (actors.length === 0) {
    return {
      confirmed: [],
      pending: ["Los actores de negocio no quedan explícitos en rutas, módulos o docs; requieren confirmación manual."]
    };
  }

  return {
    confirmed: uniqueSorted(actors),
    pending: []
  };
}

function detectDataSignals(discovery: DiscoveryResult, flatDependencies: string[]): string[] {
  const signals: string[] = [];
  const add = (label: string, evidence: string[]) => signals.push(`${label}${toEvidence(sample(evidence, 4))}`);

  const prismaSchemaFiles = matchingFiles(discovery, /(^|\/)prisma\/schema\.prisma$/i);
  const prismaMigrationFiles = matchingFiles(discovery, /(^|\/)prisma\/migrations\//i);
  const prismaSeedFiles = matchingFiles(discovery, /(^|\/)prisma\/(seed(\.[^/]+)?|seeds\/)/i);
  if (prismaSchemaFiles.length > 0) {
    add("Prisma schema define la fuente de verdad relacional", [
      ...prismaSchemaFiles,
      ...prismaMigrationFiles,
      ...prismaSeedFiles
    ]);
  } else if (prismaMigrationFiles.length > 0) {
    add("Prisma migrations versiona la capa de persistencia relacional", [...prismaMigrationFiles, ...prismaSeedFiles]);
  }

  const drizzleFiles = uniqueSorted([
    ...matchingFiles(discovery, /(^|\/)drizzle(\/|$)/i),
    ...matchingFiles(discovery, /(^|\/)drizzle\.config\.(ts|js|mts|cts)$/i)
  ]);
  if (drizzleFiles.length > 0 || flatDependencies.some((dependency) => dependency.includes("drizzle-orm"))) {
    add("Drizzle define una parte explícita de la capa de persistencia", [...drizzleFiles, ...matchingFiles(discovery, /\.sql$/i)]);
  }

  const sqlMigrationFiles = matchingFiles(discovery, /(^|\/)(migrations?|db\/migrations)\//i).filter(
    (filePath) => !/\/prisma\//i.test(filePath)
  );
  if (sqlMigrationFiles.length > 0) {
    add("Migraciones SQL versionadas sugieren una fuente de verdad relacional", [
      ...sqlMigrationFiles,
      ...matchingFiles(discovery, /\.sql$/i).filter((filePath) => !/\/prisma\//i.test(filePath))
    ]);
  }

  const dependencySignals = matchingDependencies(flatDependencies, DATA_DEPENDENCY_MAP);
  for (const signal of dependencySignals) {
    add(`${signal} está presente en dependencias`, discovery.manifests);
  }

  return uniquePreserved(signals);
}

function detectFrontendSignals(discovery: DiscoveryResult, flatDependencies: string[]): FrontendSignals {
  const appRoutes = matchingFiles(discovery, /(^|\/)(src\/)?app\/.+\/page\.(ts|tsx|js|jsx|mdx)$/i, 120);
  const appLayouts = matchingFiles(discovery, /(^|\/)(src\/)?app\/.+\/layout\.(ts|tsx|js|jsx|mdx)$/i, 80);
  const rootAppRoutes = matchingFiles(discovery, /(^|\/)(src\/)?app\/page\.(ts|tsx|js|jsx|mdx)$/i, 8);
  const pageRoutes = matchingFiles(
    discovery,
    /(^|\/)(src\/)?pages\/(?!api\/)(?!_app\.|_document\.|_error\.)[^/].+\.(ts|tsx|js|jsx|mdx)$/i,
    80
  );
  const componentRoots = uniqueSorted(
    [
      discovery.files.some((filePath) => /^components\//.test(filePath)) ? "components/" : "",
      discovery.files.some((filePath) => /^src\/components\//.test(filePath)) ? "src/components/" : "",
      discovery.files.some((filePath) => /^app\/components\//.test(filePath)) ? "app/components/" : "",
      discovery.files.some((filePath) => /^app\/src\/components\//.test(filePath)) ? "app/src/components/" : "",
      discovery.files.some((filePath) => /^app\/src\/app\/components\//.test(filePath)) ? "app/src/app/components/" : "",
      discovery.files.some((filePath) => /^src\/app\/components\//.test(filePath)) ? "src/app/components/" : "",
      discovery.files.some((filePath) => /^src\/ui\//.test(filePath)) ? "src/ui/" : "",
      discovery.files.some((filePath) => /^components\/ui\//.test(filePath)) ? "components/ui/" : "",
      discovery.files.some((filePath) => /^app\/src\/components\/ui\//.test(filePath)) ? "app/src/components/ui/" : "",
      discovery.files.some((filePath) => /^app\/src\/app\/components\/ui\//.test(filePath)) ? "app/src/app/components/ui/" : ""
    ].filter(Boolean)
  );
  const componentFiles = matchingFiles(discovery, /(^|\/)(components|ui)\//i, 12);
  const i18nSignals = uniqueSorted([
    ...matchingDependencies(flatDependencies, I18N_DEPENDENCY_MAP),
    ...matchingFiles(discovery, /(^|\/)(locales|messages|i18n)\//i, 6)
  ]);
  const stateSignals = matchingDependencies(flatDependencies, STATE_DEPENDENCY_MAP);
  const dataFetchingSignals = matchingDependencies(flatDependencies, DATA_FETCHING_DEPENDENCY_MAP);
  const uiSignals = uniqueSorted([
    ...matchingDependencies(flatDependencies, UI_DEPENDENCY_MAP),
    ...matchingFiles(discovery, /(tailwind\.config|postcss\.config|components\/ui\/|src\/ui\/)/i, 6)
  ]);
  const adminSignals = matchingFiles(discovery, /(^|\/)(admin|backoffice|dashboard)(\/|$)/i, 8);

  let renderingStrategy: string | undefined;
  if (appRoutes.length > 0 || rootAppRoutes.length > 0) {
    renderingStrategy = `Next.js App Router${toEvidence(sample([...rootAppRoutes, ...appRoutes, ...appLayouts], 4))}`;
  } else if (pageRoutes.length > 0) {
    renderingStrategy = `Next.js Pages Router${toEvidence(sample(pageRoutes, 4))}`;
  } else if (
    discovery.frameworks.includes("React") &&
    discovery.files.some((filePath) => /(^|\/)(src\/)?(main|index)\.(tsx|jsx)$/i.test(filePath))
  ) {
    renderingStrategy = `Cliente SPA de React${toEvidence(sample(matchingFiles(discovery, /(^|\/)(src\/)?(main|index)\.(tsx|jsx)$/i, 4)))}`;
  }

  return {
    routeFiles: uniqueSorted([...rootAppRoutes, ...appRoutes, ...pageRoutes]),
    layoutFiles: appLayouts,
    pageFiles: uniqueSorted([...rootAppRoutes, ...appRoutes, ...pageRoutes]),
    componentRoots,
    componentFiles,
    renderingStrategy,
    i18nSignals,
    stateSignals,
    dataFetchingSignals,
    uiSignals,
    adminSignals
  };
}

function detectBackendSignals(discovery: DiscoveryResult, flatDependencies: string[]): BackendSignals {
  const routeFiles = uniqueSorted(
    [
      ...matchingFiles(discovery, /(^|\/)(src\/)?app\/api\/.+\/route\.(ts|tsx|js|jsx)$/i, 160),
      ...matchingFiles(discovery, /(^|\/)(src\/)?pages\/api\/.+\.(ts|tsx|js|jsx)$/i, 80),
      ...matchingFiles(discovery, /(^|\/)(routes|controllers|api)\//i, 80)
    ]
  ).slice(0, 120);

  const contractFiles = uniqueSorted([
    ...discovery.apiFiles,
    ...matchingFiles(discovery, /(schema\.graphql|schema\.prisma|openapi|swagger)/i),
    ...matchingFiles(discovery, /(^|\/)(API|ARCHITECTURE|FLOWS|BUSINESS_RULES)\.(md|mdx|txt)$/i, 12),
    ...matchingFiles(discovery, /(^|\/)app\/docs\/technical\/ACCESS_CONTROL\.(md|mdx|txt)$/i, 4)
  ]).filter((filePath) => !/^AI_CONTEXT\//i.test(filePath));

  const authSignals = uniqueSorted([
    ...matchingDependencies(flatDependencies, AUTH_DEPENDENCY_MAP),
    ...matchingFiles(discovery, /(^|\/)(auth|middleware|guards?|permissions?|acl|rbac)\//i, 8)
  ]);

  const validationSignals = uniqueSorted([
    ...matchingDependencies(flatDependencies, VALIDATION_DEPENDENCY_MAP),
    ...matchingFiles(discovery, /(^|\/)(validators?|schemas?)\//i, 8)
  ]);

  const dataSignals = detectDataSignals(discovery, flatDependencies);
  const queueSignals = uniqueSorted([
    ...matchingDependencies(flatDependencies, QUEUE_DEPENDENCY_MAP),
    ...matchingFiles(discovery, /(^|\/)(jobs|workers|queues?|cron|schedules?)\//i, 8)
  ]);
  const webhookSignals = matchingFiles(discovery, /(^|\/)(webhooks?|integrations?)\//i, 10);
  const integrationSignals = uniqueSorted([
    ...matchingFiles(discovery, /(^|\/)(integrations?|clients?|adapters?)\//i, 10),
    ...matchingFiles(discovery, /(stripe|slack|sendgrid|twilio|s3|aws|gcp|azure)/i, 10)
  ]);

  return {
    routeFiles,
    endpointExamples: [],
    contractFiles,
    authSignals,
    validationSignals,
    dataSignals,
    queueSignals,
    webhookSignals,
    integrationSignals
  };
}

function pickPrimaryDataSignal(dataSignals: string[]): string | undefined {
  const priorities = [
    /^Prisma schema define/i,
    /^Prisma migrations versiona/i,
    /^Drizzle define/i,
    /^Migraciones SQL versionadas/i
  ];

  for (const pattern of priorities) {
    const match = dataSignals.find((signal) => pattern.test(signal));
    if (match) {
      return match;
    }
  }

  return dataSignals[0];
}

function inferEndpointGroup(entry: string): string {
  const match = entry.match(/\b(\/api\/[^\s)]+)/i);
  if (!match?.[1]) {
    return entry;
  }

  const segments = match[1].replace(/^\/api\//i, "").split("/").filter(Boolean);
  if (segments.length === 0) {
    return "api";
  }

  if (segments[0] === "admin" || segments[0] === "profile") {
    return segments.slice(0, 2).join("/");
  }

  return segments[0];
}

function scoreEndpointExample(entry: string): number {
  let score = 0;

  if (/\/api\/events\b/i.test(entry)) {
    score += 20;
  }
  if (/\/api\/routes\b/i.test(entry)) {
    score += 19;
  }
  if (/\/api\/profile\/business\b/i.test(entry)) {
    score += 18;
  }
  if (/\/api\/reports\b/i.test(entry)) {
    score += 17;
  }
  if (/\/api\/notifications\b/i.test(entry)) {
    score += 16;
  }
  if (/\/api\/reviews\b/i.test(entry)) {
    score += 15;
  }
  if (/\/api\/social\b/i.test(entry)) {
    score += 14;
  }
  if (/\/api\/upload\b/i.test(entry)) {
    score += 13;
  }
  if (/\/api\/admin\b/i.test(entry)) {
    score += 12;
  }
  if (/\/api\/auth\b/i.test(entry)) {
    score += 11;
  }

  return score;
}

function pickRepresentativeEndpointExamples(entries: string[], limit: number): string[] {
  const sorted = uniqueSorted(entries).sort(
    (left, right) => scoreEndpointExample(right) - scoreEndpointExample(left) || left.localeCompare(right)
  );
  const selected: string[] = [];
  const seenGroups = new Set<string>();

  for (const entry of sorted) {
    const group = inferEndpointGroup(entry);
    if (seenGroups.has(group)) {
      continue;
    }
    selected.push(entry);
    seenGroups.add(group);
    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const entry of sorted) {
    if (selected.includes(entry)) {
      continue;
    }
    selected.push(entry);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

async function extractInlineEndpoints(context: ProjectContext, backend: BackendSignals): Promise<string[]> {
  const endpointExamples = new Set<string>();
  const candidateFiles = uniqueSorted([
    ...backend.routeFiles,
    ...matchingFiles(context.discovery, /(^|\/)src\/index\.(ts|js)$/i, 2),
    ...matchingFiles(context.discovery, /(^|\/)server\//i, 6)
  ]);

  for (const filePath of candidateFiles) {
    const content = await readTextSafe(path.join(context.targetPath, filePath));
    if (!content) {
      continue;
    }

    for (const match of content.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/gi)) {
      endpointExamples.add(`${String(match[1]).toUpperCase()} ${String(match[2])} (${filePath})`);
    }

    for (const match of content.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
      endpointExamples.add(`${String(match[1]).toUpperCase()} ${String(match[2])} (${filePath})`);
    }

    if (/\/route\.(ts|tsx|js|jsx)$/i.test(filePath)) {
      const routePath = filePath
        .replace(/^(src\/)?app\/api\//i, "/api/")
        .replace(/\/route\.(ts|tsx|js|jsx)$/i, "")
        .replace(/\[([^\]]+)\]/g, ":$1");

      for (const match of content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) {
        endpointExamples.add(`${String(match[1]).toUpperCase()} ${routePath} (${filePath})`);
      }
    }

    if (/\/pages\/api\//i.test(filePath)) {
      const routePath = filePath
        .replace(/^(src\/)?pages\/api\//i, "/api/")
        .replace(/\.(ts|tsx|js|jsx)$/i, "")
        .replace(/\/index$/i, "")
        .replace(/\[([^\]]+)\]/g, ":$1");

      endpointExamples.add(`API handler ${routePath} (${filePath})`);
    }
  }

  return pickRepresentativeEndpointExamples([...endpointExamples], 16);
}

function detectModuleSignals(discovery: DiscoveryResult): ModuleSignal[] {
  const moduleMap = new Map<string, ModuleSignal>();

  const push = (label: string, filePath: string, note: string, status: ModuleSignal["status"] = "active") => {
    const existing = moduleMap.get(label);
    if (existing) {
      if (!existing.files.includes(filePath)) {
        existing.files.push(filePath);
      }
      return;
    }

    moduleMap.set(label, {
      label,
      files: [filePath],
      status,
      note
    });
  };

  for (const filePath of discovery.files) {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/");

    if (/^(src\/)?(features|domains|modules)\//i.test(normalized) && parts[2]) {
      push(parts[2], normalized, "Módulo explícito bajo `features/`, `domains/` o `modules/`.");
      continue;
    }

    if (/^(src\/)?app\//i.test(normalized) && parts[parts.length - 1]?.match(/^(page|layout|route)\./)) {
      const routeGroup = parts.slice(parts[0] === "src" ? 2 : 1, Math.max(parts.length - 1, parts[0] === "src" ? 3 : 2)).join("/");
      push(routeGroup || "root-route", normalized, "Superficie de ruta activa en App Router.");
      continue;
    }

    if (/^(src\/)?pages\//i.test(normalized) && !/\/api\//i.test(normalized) && !/_app\.|_document\.|_error\./i.test(normalized)) {
      const routeGroup = parts.slice(parts[0] === "src" ? 2 : 1, Math.max(parts.length - 1, parts[0] === "src" ? 3 : 2)).join("/");
      push(routeGroup || "root-page", normalized, "Superficie de ruta activa en Pages Router.");
      continue;
    }
  }

  if (moduleMap.size === 0) {
    for (const topLevel of discovery.structure.topLevelDirectories) {
      const relatedFiles = discovery.files.filter((filePath) => filePath.startsWith(`${topLevel}/`)).slice(0, 4);
      const lower = topLevel.toLowerCase();
      const status =
        /legacy|deprecated|old/.test(lower) ? "legacy" : /fallback|compat/.test(lower) ? "fallback" : "active";
      moduleMap.set(topLevel, {
        label: topLevel,
        files: relatedFiles,
        status,
        note: "Superficie estructural detectada en el escaneo del repo."
      });
    }
  }

  return [...moduleMap.values()]
    .map((signal) => ({
      ...signal,
      files: uniqueSorted(signal.files).slice(0, 4)
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function buildSystemOverview(
  metadata: RepoMetadata,
  discovery: DiscoveryResult,
  frontend: FrontendSignals,
  backend: BackendSignals,
  documentation: DocumentationSignals,
  navigation: NavigationSignals
): { content: string; summary: string[]; pending: string[] } {
  const confirmed: string[] = [];
  const pending: string[] = [...documentation.pending];
  const goal = inferSystemGoal(metadata, discovery);
  const actors = detectActors(discovery);

  confirmed.push(`Repositorio: \`${discovery.repoName}\`${toEvidence(sample(discovery.manifests, 3))}`);

  if (goal.confirmed) {
    confirmed.push(`Objetivo del sistema: ${goal.confirmed}`);
  }
  if (goal.pending) {
    pending.push(goal.pending);
  }

  confirmed.push(`Arquitectura operativa actual: ${inferProjectShape(discovery)} con ${discovery.frameworks.join(", ") || "runtime pendiente de confirmar"} y ${discovery.apis.join(", ") || "sin contratos confirmados"}${toEvidence(sampleSourceEvidence([...discovery.manifests, ...discovery.apiFiles, ...discovery.structure.sampleFiles], 5))}`);
  confirmed.push(`Stack principal: lenguajes=${discovery.languages.join(", ") || "Pendiente de confirmar"}; frameworks=${discovery.frameworks.join(", ") || "Pendiente de confirmar"}; testing=${discovery.testing.join(", ") || "Pendiente de confirmar"}${toEvidence(sample([...discovery.manifests, ...discovery.files.filter((filePath) => /Dockerfile|\.github\/workflows\//.test(filePath))], 5))}`);

  for (const actor of actors.confirmed) {
    confirmed.push(`Actor principal: ${actor}`);
  }
  pending.push(...actors.pending);
  for (const actor of documentation.actorEntries.slice(0, 4)) {
    confirmed.push(`Actor documentado: ${actor}`);
  }

  const primaryDataSignal = pickPrimaryDataSignal(backend.dataSignals);
  if (primaryDataSignal) {
    confirmed.push(`Persistencia y fuente de verdad: ${primaryDataSignal}`);
  } else if (backend.contractFiles.length > 0) {
    confirmed.push(`Fuente de verdad parcial: contratos o esquemas versionados${toEvidence(sample(backend.contractFiles, 4))}`);
    pending.push("La fuente de verdad de datos persistidos no queda explícita en ORM, migraciones o esquemas de base de datos.");
  } else {
    pending.push("No se confirmó una fuente de verdad de datos persistidos en código o manifests.");
  }

  const restrictions: string[] = [];
  if (metadata.scripts.length > 0) {
    restrictions.push(`scripts raíz disponibles: ${metadata.scripts.join(", ")}${toEvidence(["package.json"])}`);
  }
  if (discovery.ci.providers.length > 0) {
    restrictions.push(`CI detectado: ${discovery.ci.providers.join(", ")}${toEvidence(sample(discovery.files.filter((filePath) => filePath.startsWith(".github/workflows/")), 3))}`);
  }
  if (frontend.renderingStrategy) {
    restrictions.push(`rendering strategy activa: ${frontend.renderingStrategy}`);
  }
  if (discovery.infrastructure.length > 0) {
    restrictions.push(`superficie operativa: ${discovery.infrastructure.join(", ")}${toEvidence(sample(discovery.infraFiles, 4))}`);
  }
  if (restrictions.length > 0) {
    confirmed.push(...restrictions.map((restriction) => `Restricción técnica permanente: ${restriction}`));
  } else {
    pending.push("No hay restricciones técnicas permanentes documentadas de forma explícita; conviene confirmarlas manualmente.");
  }
  if (navigation.guardSummaries.length > 0) {
    confirmed.push(`Restricción técnica permanente: guardas de navegación/acceso detectadas${toEvidence(sample(navigation.guardFiles, 4))}`);
  }
  if (documentation.authority.declaredCanonicalSources.length > 0) {
    confirmed.push(`Fuentes canónicas declaradas por la documentación: ${documentation.authority.declaredCanonicalSources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  if (documentation.authority.primarySources.length > 0) {
    confirmed.push(
      `${documentation.authority.declaredCanonicalSources.length > 0 ? "Documentos operativos de referencia" : "Fuentes primarias operativas"}: ${documentation.authority.primarySources
        .map((filePath) => `\`${filePath}\``)
        .join(", ")}`
    );
  }
  if (documentation.authority.secondarySources.length > 0) {
    confirmed.push(`Fuentes secundarias de apoyo: ${documentation.authority.secondarySources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  confirmed.push(...documentation.authority.authorityNotes.slice(0, 2));
  pending.push(...documentation.authority.ambiguousSources);
  confirmed.push(...documentation.summary.slice(0, 2));

  const summary = [
    `Proyecto: ${discovery.repoName}`,
    `Forma actual: ${inferProjectShape(discovery)}`,
    `Stack: ${discovery.languages.join(", ") || "pendiente"} / ${discovery.frameworks.join(", ") || "pendiente"}`,
    `APIs o contratos: ${discovery.apis.join(", ") || "sin confirmar"}`,
    `Fuente de verdad: ${primaryDataSignal ?? "pendiente de confirmar"}`,
    `Frontend: ${frontend.renderingStrategy ?? "sin superficie frontend confirmada"}`,
    `CI/testing: ${discovery.ci.providers.join(", ") || "sin CI detectado"} / ${discovery.testing.join(", ") || "sin testing confirmado"}`
  ];

  return {
    content: `# System Overview

## Estado actual

${renderList(confirmed)}

## Pendiente de confirmar

${renderList(uniqueSorted(pending))}
`,
    summary,
    pending: uniqueSorted(pending)
  };
}

function buildModulesMap(
  discovery: DiscoveryResult,
  frontend: FrontendSignals,
  backend: BackendSignals,
  documentation: DocumentationSignals,
  navigation: NavigationSignals
): { content: string; pending: string[] } {
  const modules = detectModuleSignals(discovery);
  const confirmed: string[] = documentation.domainEntries.map((domainEntry) => {
    const notes = [
      domainEntry.docFiles.length > 0 ? `docs=${domainEntry.docFiles.map((filePath) => `\`${filePath}\``).join(", ")}` : "",
      domainEntry.codeFiles.length > 0 ? `superficies=${domainEntry.codeFiles.map((filePath) => `\`${filePath}\``).join(", ")}` : "",
      domainEntry.highlights.length > 0 ? `señales=${domainEntry.highlights.join(" | ")}` : ""
    ]
      .filter(Boolean)
      .join("; ");

    return `Dominio ${domainEntry.label}: ${notes}`;
  });
  const highlightedModules = modules.slice(0, documentation.domainEntries.length > 0 ? 16 : 24);
  confirmed.push(...highlightedModules.map((moduleSignal) => {
    const status = moduleSignal.status === "legacy" ? "legacy" : moduleSignal.status === "fallback" ? "fallback" : "activo";
    return `Módulo ${moduleSignal.label}: ${moduleSignal.note}; estado=${status}${toEvidence(moduleSignal.files)}`;
  }));
  const pending: string[] = [...documentation.pending];

  if (frontend.routeFiles.length > 0) {
    confirmed.push(`Rutas clave: ${pickRepresentativeFiles(frontend.routeFiles, 8).map((filePath) => `\`${filePath}\``).join(", ")}`);
  } else if (backend.routeFiles.length > 0 || backend.contractFiles.length > 0) {
    confirmed.push(`Superficie de rutas/backend: ${sample([...backend.routeFiles, ...backend.contractFiles], 8).map((filePath) => `\`${filePath}\``).join(", ")}`);
  } else {
    pending.push("No se detectaron rutas clave en convenciones comunes (`app/`, `pages/`, `routes/`, `controllers/`).");
  }

  if (frontend.adminSignals.length > 0) {
    confirmed.push(`Panel admin o backoffice detectado${toEvidence(sample(frontend.adminSignals, 4))}`);
  } else {
    pending.push("No se confirmó un panel admin/backoffice en rutas o carpetas con nombres explícitos.");
  }
  if (navigation.navFiles.length > 0) {
    confirmed.push(`Superficies de navegación: ${pickRepresentativeFiles(navigation.navFiles, 8).map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  if (navigation.actorScopes.length > 0) {
    confirmed.push(`Scopes o actores con navegación propia: ${navigation.actorScopes.map((scope) => `\`${scope}\``).join(", ")}`);
  }

  const primaryDataSignal = pickPrimaryDataSignal(backend.dataSignals);
  if (primaryDataSignal) {
    confirmed.push(`Relación módulo-datos: ${primaryDataSignal}`);
  } else {
    pending.push("La relación entre módulos y la fuente de verdad de datos requiere confirmación manual.");
  }

  if (!modules.some((moduleSignal) => moduleSignal.status !== "active")) {
    pending.push("No se encontraron superficies marcadas como legacy o fallback por naming; si existen, requieren confirmación manual.");
  }
  if (modules.length > highlightedModules.length) {
    confirmed.push(`Superficies adicionales detectadas: ${modules.length - highlightedModules.length} módulos/rutas más; priorizar dominios documentados para trabajo operativo.`);
  }

  return {
    content: `# Modules Map

## Estado actual

${renderList(confirmed)}

## Pendiente de confirmar

${renderList(uniqueSorted(pending))}
`,
    pending: uniqueSorted(pending)
  };
}

function buildFrontendArchitecture(
  frontend: FrontendSignals,
  discovery: DiscoveryResult,
  navigation: NavigationSignals
): { content: string; pending: string[] } {
  const confirmed: string[] = [];
  const pending: string[] = [];

  if (frontend.renderingStrategy) {
    confirmed.push(`Rendering strategy: ${frontend.renderingStrategy}`);
  } else {
    pending.push("No se confirmó una estrategia de rendering frontend en `app/`, `pages/`, `main.tsx` o `index.tsx`.");
  }

  if (frontend.layoutFiles.length > 0 || frontend.pageFiles.length > 0) {
    confirmed.push(`Layouts y páginas: ${pickRepresentativeFiles([...frontend.layoutFiles, ...frontend.pageFiles], 8).map((filePath) => `\`${filePath}\``).join(", ")}`);
  } else {
    pending.push("No se confirmó una estructura de layouts/páginas frontend.");
  }

  if (frontend.componentRoots.length > 0) {
    confirmed.push(`Raíces de componentes: ${frontend.componentRoots.map((root) => `\`${root}\``).join(", ")}${toEvidence(sample(frontend.componentFiles, 4))}`);
  } else {
    pending.push("No se detectó una raíz clara de componentes reutilizables.");
  }

  if (navigation.navFiles.length > 0) {
    confirmed.push(
      `Navegación y shells: archivos=${pickRepresentativeFiles(navigation.navFiles, 8).map((filePath) => `\`${filePath}\``).join(", ")}${
        navigation.navLabels.length > 0 ? `; entradas=${navigation.navLabels.map((label) => `"${label}"`).join(", ")}` : ""
      }${navigation.navSectionLabels.length > 0 ? `; secciones=${navigation.navSectionLabels.map((label) => `"${label}"`).join(", ")}` : ""}`
    );
  } else if (discovery.frameworks.includes("React") || discovery.frameworks.includes("NextJS")) {
    pending.push("No se detectaron sidebars, nav configs o shells de navegación por naming convencional.");
  }

  if (frontend.i18nSignals.length > 0) {
    confirmed.push(`i18n: ${frontend.i18nSignals.map((signal) => `\`${signal}\``).join(", ")}`);
  } else {
    pending.push("No se confirmaron librerías o carpetas de i18n/locales.");
  }

  if (frontend.stateSignals.length > 0 || frontend.dataFetchingSignals.length > 0) {
    confirmed.push(
      `Estado y data fetching: ${[
        frontend.stateSignals.length > 0 ? `state=${frontend.stateSignals.join(", ")}` : "",
        frontend.dataFetchingSignals.length > 0 ? `data=${frontend.dataFetchingSignals.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("; ")}`
    );
  } else if (discovery.frameworks.includes("React") || discovery.frameworks.includes("NextJS")) {
    pending.push("No se confirmaron librerías explícitas de estado o fetching; puede existir uso directo de `fetch` o utilidades locales.");
  }

  if (frontend.uiSignals.length > 0) {
    confirmed.push(`Sistema visual y dependencias UI: ${frontend.uiSignals.map((signal) => `\`${signal}\``).join(", ")}`);
  } else if (discovery.frameworks.includes("React") || discovery.frameworks.includes("NextJS")) {
    pending.push("No se confirmaron dependencias visuales base; revisar CSS global y componentes raíz manualmente.");
  }

  if (confirmed.length === 0) {
    confirmed.push("No hay una superficie frontend principal confirmada; el repo parece orientado a backend o infraestructura.");
  }

  return {
    content: `# Frontend Architecture

## Estado actual

${renderList(confirmed)}

## Pendiente de confirmar

${renderList(uniqueSorted(pending))}
`,
    pending: uniqueSorted(pending)
  };
}

function buildBackendFlowsAndContracts(
  backend: BackendSignals,
  discovery: DiscoveryResult,
  documentation: DocumentationSignals
): { content: string; pending: string[] } {
  const confirmed: string[] = [];
  const pending: string[] = [];

  if (backend.endpointExamples.length > 0) {
    confirmed.push(`Endpoints reales detectados: ${backend.endpointExamples.map((entry) => `\`${entry}\``).join(", ")}`);
  } else if (backend.contractFiles.length > 0) {
    confirmed.push(`Contratos o superficies API: ${sample(backend.contractFiles, 8).map((filePath) => `\`${filePath}\``).join(", ")}`);
    pending.push("Los handlers concretos de endpoints no se confirmaron en patrones inline (`app.get`, `router.get`, `route.ts`).");
  } else {
    pending.push("No se confirmaron endpoints reales ni contratos versionados.");
  }

  if (backend.authSignals.length > 0) {
    confirmed.push(`Autenticación/autorización: ${backend.authSignals.map((signal) => `\`${signal}\``).join(", ")}`);
  } else {
    pending.push("No se confirmó una capa de auth/authz en dependencias o carpetas convencionales.");
  }

  if (backend.validationSignals.length > 0) {
    confirmed.push(`Validaciones: ${backend.validationSignals.map((signal) => `\`${signal}\``).join(", ")}`);
  } else {
    pending.push("No se confirmaron validadores o esquemas explícitos de entrada.");
  }

  if (backend.dataSignals.length > 0) {
    confirmed.push(`Acceso a datos: ${backend.dataSignals.join("; ")}`);
  } else {
    pending.push("No se confirmó una capa explícita de acceso a base de datos, migraciones o seeds.");
  }

  if (backend.queueSignals.length > 0 || backend.webhookSignals.length > 0 || backend.integrationSignals.length > 0) {
    confirmed.push(
      `Jobs/webhooks/integraciones: ${[
        backend.queueSignals.length > 0 ? `jobs=${backend.queueSignals.join(", ")}` : "",
        backend.webhookSignals.length > 0 ? `webhooks=${backend.webhookSignals.join(", ")}` : "",
        backend.integrationSignals.length > 0 ? `integraciones=${backend.integrationSignals.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("; ")}`
    );
  } else {
    pending.push("No se confirmaron colas, webhooks o integraciones externas en superficies convencionales.");
  }

  if (backend.contractFiles.length > 0) {
    confirmed.push(`Contratos vigentes frontend/backend: ${backend.contractFiles.map((filePath) => `\`${filePath}\``).join(", ")}`);
  } else if (discovery.apis.length > 0) {
    pending.push("Hay señales de API, pero no un contrato versionado claro entre frontend y backend.");
  }

  if (documentation.authority.declaredCanonicalSources.length > 0) {
    confirmed.push(`Fuentes canónicas declaradas para contratos/reglas: ${documentation.authority.declaredCanonicalSources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  if (documentation.authority.primarySources.length > 0) {
    confirmed.push(
      `${documentation.authority.declaredCanonicalSources.length > 0 ? "Documentos operativos de referencia" : "Fuentes primarias para contratos/reglas"}: ${documentation.authority.primarySources
        .map((filePath) => `\`${filePath}\``)
        .join(", ")}`
    );
  }
  if (documentation.authority.secondarySources.length > 0) {
    confirmed.push(`Fuentes secundarias relevantes: ${documentation.authority.secondarySources.map((filePath) => `\`${filePath}\``).join(", ")}`);
  }
  confirmed.push(...documentation.authority.authorityNotes.slice(0, 2));
  pending.push(...documentation.authority.ambiguousSources);

  return {
    content: `# Backend Flows And Contracts

## Estado actual

${renderList(confirmed)}

## Pendiente de confirmar

${renderList(uniqueSorted(pending))}
`,
    pending: uniqueSorted(pending)
  };
}

function buildUiRules(
  frontend: FrontendSignals,
  discovery: DiscoveryResult,
  navigation: NavigationSignals
): { content: string; pending: string[] } {
  const confirmed: string[] = [];
  const pending: string[] = [];

  if (frontend.uiSignals.length > 0) {
    confirmed.push(`Dirección visual activa: ${frontend.uiSignals.map((signal) => `\`${signal}\``).join(", ")}`);
  } else if (discovery.frameworks.includes("React") || discovery.frameworks.includes("NextJS")) {
    pending.push("No se confirmó una dirección visual activa a partir de dependencias UI o config CSS.");
  }

  if (frontend.componentRoots.length > 0) {
    confirmed.push(`Componentes base a respetar: ${frontend.componentRoots.map((root) => `\`${root}\``).join(", ")}${toEvidence(sample(frontend.componentFiles, 5))}`);
  } else {
    pending.push("No se confirmó una base clara de componentes reutilizables.");
  }

  if (frontend.renderingStrategy) {
    confirmed.push(`Regla de implementación: respetar la estrategia de rutas/rendering ya activa (${frontend.renderingStrategy}).`);
  }
  if (navigation.navFiles.length > 0) {
    confirmed.push(
      `Navegación operacional: mantener shells y menús por actor${toEvidence(sample(navigation.navFiles, 5))}${
        navigation.actorScopes.length > 0 ? ` Scopes detectados: ${navigation.actorScopes.map((scope) => `\`${scope}\``).join(", ")}.` : ""
      }`
    );
  }
  if (navigation.guardSummaries.length > 0) {
    confirmed.push(`Permisos y guardas UI: ${navigation.guardSummaries.slice(0, 4).map((entry) => `\`${entry}\``).join(", ")}`);
  } else {
    pending.push("No se confirmaron guardas de navegación o permisos UI desde layouts, auth helpers o archivos de acceso.");
  }

  if (frontend.uiSignals.some((signal) => signal.includes("Tailwind"))) {
    confirmed.push("Responsive: la superficie parece utility-first; cambios visuales deben respetar clases y layout utilities existentes.");
  } else {
    pending.push("Las reglas de responsive necesitan confirmación manual si no hay un sistema CSS explícito detectado.");
  }

  if (frontend.componentFiles.some((filePath) => /dialog|modal|form|table|button/i.test(filePath))) {
    confirmed.push(`Patrones que no deben degradarse: formularios, tablas o acciones base detectadas${toEvidence(sample(frontend.componentFiles.filter((filePath) => /dialog|modal|form|table|button/i.test(filePath)), 5))}`);
  } else {
    pending.push("No se confirmaron patrones UI sensibles como forms, tablas o modales por naming explícito.");
  }

  if (frontend.i18nSignals.length > 0) {
    confirmed.push("Copy/i18n: respetar la infraestructura de traducción ya presente antes de introducir strings inline.");
  } else {
    pending.push("Accesibilidad y copy requieren revisión manual; no hay señales suficientes de tooling o reglas explícitas.");
  }

  if (confirmed.length === 0) {
    confirmed.push("No hay una UI principal confirmada; no deben imponerse reglas visuales imaginarias.");
  }

  return {
    content: `# UI Rules

## Estado actual

${renderList(confirmed)}

## Pendiente de confirmar

${renderList(uniqueSorted(pending))}
`,
    pending: uniqueSorted(pending)
  };
}

function buildGeneratedDecisions(
  discovery: DiscoveryResult,
  frontend: FrontendSignals,
  backend: BackendSignals,
  documentation: DocumentationSignals
): string {
  const entries: string[] = [];

  for (const decision of documentation.decisionEntries.slice(0, 4)) {
    entries.push(`Decisión documentada: ${decision}`);
  }

  if (discovery.frameworks.length > 0) {
    entries.push(`La base tecnológica actual gira alrededor de ${discovery.frameworks.join(", ")}${toEvidence(sample(discovery.manifests, 3))}; la justificación explícita no está documentada y requiere confirmación manual si importa para cambios grandes.`);
  }
  if (frontend.renderingStrategy) {
    entries.push(`La estrategia de frontend activa es ${frontend.renderingStrategy}; futuros cambios deben respetar esa partición antes de mezclar routers o modos de rendering.`);
  }
  if (backend.contractFiles.length > 0) {
    entries.push(`Los contratos versionados actuales pasan por ${backend.contractFiles.map((filePath) => `\`${filePath}\``).join(", ")}; cualquier cambio debe tratarlos como artefactos vigentes.`);
  }
  if (backend.dataSignals.length > 0) {
    entries.push(`La persistencia o sus señales explícitas viven en ${backend.dataSignals.join("; ")}; no conviene asumir una segunda fuente de verdad sin confirmar ownership.`);
  }
  if (documentation.authority.declaredCanonicalSources.length > 0) {
    entries.push(`La documentación vigente declara como canon ${documentation.authority.declaredCanonicalSources.map((filePath) => `\`${filePath}\``).join(", ")}; si un markdown resumido contradice eso, debe ganar el código o schema indicado.`);
  }
  if (documentation.authority.primarySources.length > 0) {
    entries.push(`Los documentos operativos de referencia están en ${documentation.authority.primarySources.map((filePath) => `\`${filePath}\``).join(", ")}; sirven para orientar cambios, pero no sustituyen una fuente canónica declarada.`);
  }
  if (documentation.authority.ambiguousSources.length > 0) {
    entries.push(`Hay fuentes ambiguas que no deben tomarse como canon único: ${documentation.authority.ambiguousSources.join(" | ")}`);
  }

  return `## Generated snapshot ${discovery.scannedAt}

${renderList(entries.length > 0 ? entries : ["No se pudieron inferir decisiones arquitectónicas fiables sin más evidencia del repo."])}
`;
}

function buildGeneratedLearnings(
  discovery: DiscoveryResult,
  frontend: FrontendSignals,
  backend: BackendSignals,
  documentation: DocumentationSignals,
  navigation: NavigationSignals
): string {
  const entries: string[] = [];

  if (documentation.docFiles.length > 0) {
    entries.push(`Prioriza la documentación operativa detectada (${documentation.docFiles.slice(0, 4).map((filePath) => `\`${filePath}\``).join(", ")}) antes de inferir reglas desde naming o estructura superficial.`);
  }
  if (documentation.pending.length > 0) {
    entries.push(`Hay documentación que requiere validación manual: ${documentation.pending.slice(0, 2).join(" | ")}`);
  }
  if (navigation.guardSummaries.length > 0) {
    entries.push(`La navegación y el acceso parecen condicionados por auth/roles; revisar ${navigation.guardSummaries.slice(0, 3).join(" | ")} antes de simplificar menús o layouts.`);
  }

  if (backend.contractFiles.length > 0) {
    entries.push(`Trata ${backend.contractFiles.map((filePath) => `\`${filePath}\``).join(", ")} como contratos vivos antes de cambiar rutas o payloads.`);
  }
  if (documentation.authority.declaredCanonicalSources.length > 0) {
    entries.push(`La propia documentación declara como fuentes canónicas ${documentation.authority.declaredCanonicalSources.map((filePath) => `\`${filePath}\``).join(", ")}; no trates los markdown como sustituto del runtime real.`);
  }
  if (documentation.authority.primarySources.length > 0) {
    entries.push(`Antes de inferir reglas desde naming o estructura superficial, revisa los documentos operativos ${documentation.authority.primarySources.map((filePath) => `\`${filePath}\``).join(", ")}.`);
  }
  if (documentation.authority.ambiguousSources.length > 0) {
    entries.push(`Hay ambigüedades documentales activas: ${documentation.authority.ambiguousSources.join(" | ")}`);
  }
  if (!frontend.renderingStrategy) {
    entries.push("No asumas una UI completa si no hay `app/`, `pages/` o entrypoints frontend confirmados.");
  }
  if (discovery.ci.providers.length === 0) {
    entries.push("No hay CI confirmado; cualquier cambio debería validarse manualmente antes de darlo por seguro.");
  }
  if (backend.dataSignals.length === 0) {
    entries.push("La fuente de verdad de datos no quedó explícita; futuros agentes deben confirmarla antes de tocar persistencia.");
  }
  if (entries.length === 0) {
    entries.push("No se detectaron trampas críticas nuevas en esta pasada ligera; mantener el contexto alineado con código y contratos.");
  }

  return `## Generated snapshot ${discovery.scannedAt}

${renderList(entries)}
`;
}

function buildGeneratedTasks(
  discovery: DiscoveryResult,
  frontend: FrontendSignals,
  backend: BackendSignals,
  documentation: DocumentationSignals,
  navigation: NavigationSignals,
  pendingQuestions: string[]
): string {
  const tasks: string[] = [];
  const pushTask = (priority: "high" | "medium" | "low", task: string, context: string, doneWhen: string, blocker = "none") => {
    tasks.push(`[${priority}] ${task}; Contexto: ${context}; Criterio de cierre: ${doneWhen}; Bloqueo: ${blocker}.`);
  };

  if (backend.dataSignals.length === 0) {
    pushTask("high", "Confirmar la fuente de verdad de datos", "No se detectaron ORM, migraciones o schemas de persistencia inequívocos.", "La documentación identifica el owner y la capa de persistencia real.");
  }

  if (!frontend.renderingStrategy && (discovery.frameworks.includes("React") || discovery.frameworks.includes("NextJS"))) {
    pushTask("medium", "Confirmar la superficie frontend activa", "Hay framework frontend, pero no se detectó una estructura de rutas/rendering concluyente.", "Quedan documentados router, layouts y entrypoints vigentes.");
  }

  for (const pending of documentation.pending.slice(0, 2)) {
    pushTask("medium", "Validar documentación marcada como pendiente o draft", pending, "La documentación queda confirmada, corregida o descartada con evidencia en código.", "requiere validación humana");
  }

  for (const domain of documentation.domainEntries.filter((entry) => entry.codeFiles.length === 0).slice(0, 2)) {
    pushTask(
      "medium",
      "Confirmar superficie real del dominio documentado",
      `El dominio \`${domain.label}\` tiene documentación, pero no se asociaron rutas o módulos activos.`,
      "Quedan documentadas las superficies reales del dominio o se marca explícitamente como futuro/legacy.",
      "requiere validación humana"
    );
  }

  for (const note of documentation.authority.ambiguousSources.slice(0, 2)) {
    pushTask(
      "high",
      "Resolver ambigüedad en fuentes de verdad",
      note,
      "La fuente queda resuelta o se documenta explícitamente qué artefacto manda para cambios futuros.",
      "requiere validación humana"
    );
  }

  if (documentation.docFiles.length === 0) {
    pushTask("medium", "Crear documentación mínima de dominio", "No se detectaron `README` o `docs/` con señales operativas suficientes.", "Existe al menos una fuente breve y confiable de contexto por dominio principal.");
  }

  if (navigation.navFiles.length === 0 && (discovery.frameworks.includes("React") || discovery.frameworks.includes("NextJS"))) {
    pushTask("low", "Confirmar la navegación operativa", "No se detectaron archivos de navegación por naming convencional.", "Quedan documentados sidebars, nav configs o shells activos.", "necesita confirmación manual");
  }

  if (navigation.guardSummaries.length === 0 && navigation.permissionFiles.length === 0) {
    pushTask("low", "Confirmar reglas de acceso y permisos UI", "No se detectaron guardas o archivos de permisos en superficies convencionales.", "Quedan documentadas las restricciones de acceso por actor o se marca como no aplicable.", "necesita confirmación manual");
  }

  for (const pending of pendingQuestions.slice(0, 3)) {
    pushTask("low", "Resolver hueco de contexto", pending, "El hueco queda resuelto en docs o se etiqueta como no aplicable.", "necesita confirmación manual");
  }

  return `## Generated snapshot ${discovery.scannedAt}

${renderList(uniqueSorted(tasks))}
`;
}

async function upsertGeneratedSection(filePath: string, title: string, generatedContent: string): Promise<void> {
  const existing = await readTextSafe(filePath);
  const generatedBlock = `${GENERATED_START}\n${generatedContent.trim()}\n${GENERATED_END}\n`;

  if (!existing) {
    await writeFileEnsured(filePath, `# ${title}\n\n${generatedBlock}`);
    return;
  }

  if (existing.includes(GENERATED_START) && existing.includes(GENERATED_END)) {
    const updated = existing.replace(new RegExp(`${GENERATED_START}[\\s\\S]*?${GENERATED_END}\\n?`, "m"), generatedBlock);
    await writeFileEnsured(filePath, updated);
    return;
  }

  const needsTrailingNewline = existing.endsWith("\n") ? "" : "\n";
  await writeFileEnsured(filePath, `${existing}${needsTrailingNewline}\n${generatedBlock}`);
}

function buildSummaryReport(
  context: ProjectContext,
  summary: string[],
  openQuestions: string[],
  artifactPaths: string[]
): string {
  return `# Context Lite Summary

- Repository: ${context.repoName}
- Output: ${context.outputPath}
- Generated at: ${context.scannedAt}

## Real State

${renderList(summary)}

## Requires Manual Confirmation

${renderList(openQuestions)}

## Artifacts

${renderList(artifactPaths.map((filePath) => `\`${path.relative(context.outputPath, filePath) || path.basename(filePath)}\``))}
`;
}

function formatInlinePaths(paths: string[], limit = 6): string {
  return paths.length > 0 ? paths.slice(0, limit).map((filePath) => `\`${filePath}\``).join(", ") : "Pendiente de confirmar";
}

function buildMasterContextPrompt(
  context: ProjectContext,
  summary: string[],
  openQuestions: string[],
  documentation: DocumentationSignals,
  frontend: FrontendSignals,
  backend: BackendSignals,
  navigation: NavigationSignals
): string {
  const repoShape = inferProjectShape(context.discovery);
  const primaryDataSignal = pickPrimaryDataSignal(backend.dataSignals) ?? "Pendiente de confirmar";
  const coreDomains = documentation.domainEntries.slice(0, 5).map((entry) => {
    const docNotes = entry.docFiles.length > 0 ? `docs=${formatInlinePaths(entry.docFiles, 2)}` : "";
    const codeNotes = entry.codeFiles.length > 0 ? `superficies=${formatInlinePaths(entry.codeFiles, 3)}` : "";
    const notes = [docNotes, codeNotes].filter(Boolean).join("; ");
    return notes ? `\`${entry.label}\`: ${notes}` : `\`${entry.label}\``;
  });
  const canonicalSources = documentation.authority.declaredCanonicalSources;
  const operationalDocs = documentation.authority.primarySources;
  const secondarySources = documentation.authority.secondarySources;
  const ambiguityNotes = uniqueSorted([
    ...documentation.authority.ambiguousSources,
    ...openQuestions
  ]).slice(0, 6);
  const stackSnapshot = [
    `Lenguajes: ${context.discovery.languages.join(", ") || "Pendiente de confirmar"}`,
    `Frameworks: ${context.discovery.frameworks.join(", ") || "Pendiente de confirmar"}`,
    `APIs/contratos: ${context.discovery.apis.join(", ") || "Pendiente de confirmar"}`,
    `Rendering/UI: ${frontend.renderingStrategy ?? "Pendiente de confirmar"} / ${frontend.uiSignals.join(", ") || "sin sistema visual confirmado"}`,
    `Auth/validación: ${backend.authSignals.join(", ") || "sin auth confirmada"} / ${backend.validationSignals.join(", ") || "sin validadores confirmados"}`,
    `Actores/navegación: ${navigation.actorScopes.join(", ") || "sin scopes confirmados"} / ${navigation.navFiles.length > 0 ? `${navigation.navFiles.length} archivos de navegación` : "sin navegación confirmada"}`
  ];
  const activeSurfaces = [
    `Contratos y schemas confirmados: ${formatInlinePaths(backend.contractFiles, 6)}`,
    `Endpoints o handlers representativos: ${backend.endpointExamples.slice(0, 4).join(", ") || "Pendiente de confirmar"}`,
    `Guardas y permisos detectados: ${navigation.guardSummaries.slice(0, 4).join(" | ") || formatInlinePaths(navigation.guardFiles, 4)}`,
    `Testing/CI detectado: ${context.discovery.testing.join(", ") || "sin testing confirmado"} / ${context.discovery.ci.providers.join(", ") || "sin CI detectado"}`
  ];

  return `# Master Context Prompt

Generado por \`project-brain context-lite\` el ${context.scannedAt} para \`${context.repoName}\`.

Usa este prompt cuando necesites crear o refrescar el \`AI_CONTEXT/\` de este mismo proyecto sin empezar desde cero. El objetivo es continuar desde el análisis ya confirmado en esta corrida, no volver a inventar el proyecto.

## Contexto confirmado en esta corrida

- Repositorio objetivo: \`${context.targetPath}\`
- Forma detectada: ${repoShape}
- Fuente de verdad/persistencia prioritaria: ${primaryDataSignal}
${renderList(summary.slice(0, 6))}

## Señales operativas ya detectadas

${renderList(stackSnapshot)}

## Fuentes que debes priorizar

- Fuentes canónicas declaradas por esta corrida: ${formatInlinePaths(canonicalSources)}
- Documentos operativos de referencia: ${formatInlinePaths(operationalDocs)}
- Fuentes secundarias útiles: ${formatInlinePaths(secondarySources)}

## Dominios detectados en esta corrida

${renderList(coreDomains)}

## Superficies activas ya confirmadas

${renderList(activeSurfaces)}

## Huecos o ambigüedades que siguen abiertas

${renderList(ambiguityNotes)}

## Prompt

Actua como analista tecnico del repositorio actual.
Inspecciona este proyecto y crea o actualiza la carpeta \`AI_CONTEXT/\` para que otros agentes AI puedan trabajar aqui sin inventar arquitectura, flujos, reglas ni contratos.

Objetivo:
Mantener un contexto operativo, breve y confiable del proyecto real.

Reglas:
1. Inspecciona el repo completo antes de escribir:
   - \`README*\`
   - \`package.json\`, lockfiles y scripts
   - estructura de \`src/\`, \`app/\`, \`pages/\`, \`components/\`, \`lib/\`, \`api/\`
   - configuracion (\`env\`, auth, db, build, CI)
   - migraciones, schemas, seeds, contratos, tests y docs existentes
   - \`docs/\`, \`app/docs/\` y docs raiz como \`API.md\`, \`ARCHITECTURE.md\`, \`BUSINESS_RULES.md\`, \`FLOWS.md\`
2. No inventes nada.
   - Si algo no esta confirmado en codigo o docs, marcalo como \`Pendiente de confirmar\`.
   - Si hay contradiccion entre docs y codigo, prioriza el codigo, runtime o schema vigente y documenta la contradiccion.
   - Usa primero las fuentes canónicas y operativas listadas arriba; no sustituyas esas fuentes por resúmenes viejos o markdown secundarios.
3. Usa rutas reales del repositorio.
4. Cada hallazgo importante debe incluir evidencia breve:
   - \`Evidencia: ruta[:linea]\`
5. Si \`AI_CONTEXT/\` ya existe:
   - actualiza solo lo impactado
   - no borres notas manuales fuera de bloques generados
   - conserva decisiones y learnings manuales si no fueron invalidados por evidencia nueva
6. No propongas refactors imaginarios.
   - \`TASKS.md\` debe salir de evidencia real del repo.
7. Revisa primero los dominios ya detectados arriba y solo agrega dominios nuevos si aparecen confirmados en código o docs activos.
8. Si un hueco listado arriba sigue abierto tras la inspección, déjalo explícito y no lo cierres por inferencia.

Archivos a crear o actualizar:
- \`AI_CONTEXT/system_overview.md\`
- \`AI_CONTEXT/domain_inventory.md\`
- \`AI_CONTEXT/modules_map.md\`
- \`AI_CONTEXT/frontend_architecture.md\`
- \`AI_CONTEXT/backend_flows_and_contracts.md\`
- \`AI_CONTEXT/ui_rules.md\`
- \`AI_CONTEXT/DECISIONS.md\`
- \`AI_CONTEXT/LEARNINGS.md\`
- \`AI_CONTEXT/TASKS.md\`

Entrega final:
1. Crea o actualiza los archivos.
2. Resume en 10-15 lineas el estado real del proyecto.
3. Lista supuestos, huecos o zonas que requieren confirmacion manual.

## Uso recomendado

- Ejecuta este prompt dentro del repo: \`${context.targetPath}\`
- Usa como punto de partida el \`AI_CONTEXT/\` ya existente en este proyecto.
- Toma como base el snapshot confirmado de esta corrida:
${renderList(summary.slice(0, 6))}
- Si cuentas con output de \`project-brain context-lite\`, tratalo como base inicial y refresca solo lo que haya cambiado.
`;
}

async function buildDocuments(context: ProjectContext): Promise<ContextLiteDocumentSet> {
  const metadata = await loadRepoMetadata(context);
  const flatDependencies = flattenLowerDependencies(context.discovery);
  const frontend = detectFrontendSignals(context.discovery, flatDependencies);
  const backend = detectBackendSignals(context.discovery, flatDependencies);
  const documentation = await buildDocumentationSignals(context);
  const navigation = await detectNavigationSignals(context);
  backend.endpointExamples = await extractInlineEndpoints(context, backend);

  const systemOverview = buildSystemOverview(metadata, context.discovery, frontend, backend, documentation, navigation);
  const domainInventory = buildDomainInventoryDocument(documentation);
  const modulesMap = buildModulesMap(context.discovery, frontend, backend, documentation, navigation);
  const frontendArchitecture = buildFrontendArchitecture(frontend, context.discovery, navigation);
  const backendFlowsAndContracts = buildBackendFlowsAndContracts(backend, context.discovery, documentation);
  const uiRules = buildUiRules(frontend, context.discovery, navigation);

  const openQuestions = uniqueSorted([
    ...systemOverview.pending,
    ...domainInventory.pending,
    ...modulesMap.pending,
    ...frontendArchitecture.pending,
    ...backendFlowsAndContracts.pending,
    ...uiRules.pending
  ]).slice(0, 12);

  const summary = uniqueSorted([
    ...systemOverview.summary,
    `Dominios documentados: ${pickRepresentativeDomainLabels(documentation.domainEntries, 6).join(", ") || "sin dominios documentados"}`,
    `Módulos detectados: ${detectModuleSignals(context.discovery)
      .slice(0, 5)
      .map((signal) => signal.label)
      .join(", ") || "pendiente de confirmar"}`,
    `Navegación/actores: ${navigation.actorScopes.join(", ") || "sin scopes de navegación confirmados"} / ${navigation.navFiles.length > 0 ? `${navigation.navFiles.length} archivos de navegación` : "sin navegación confirmada"}`,
    `Auth/validación: ${backend.authSignals.join(", ") || "sin auth confirmada"} / ${backend.validationSignals.join(", ") || "sin validadores confirmados"}`,
    `Contratos backend: ${backend.contractFiles.join(", ") || "sin contratos confirmados"}`,
    `UI base: ${frontend.uiSignals.join(", ") || "sin sistema visual confirmado"}`,
    `Huecos principales: ${openQuestions.slice(0, 2).join(" | ") || "sin huecos críticos detectados"}`
  ]).slice(0, 12);
  const masterContextPrompt = buildMasterContextPrompt(
    context,
    summary,
    openQuestions,
    documentation,
    frontend,
    backend,
    navigation
  );

  return {
    systemOverview: systemOverview.content,
    domainInventory: domainInventory.content,
    modulesMap: modulesMap.content,
    frontendArchitecture: frontendArchitecture.content,
    backendFlowsAndContracts: backendFlowsAndContracts.content,
    uiRules: uiRules.content,
    masterContextPrompt,
    decisionsBlock: buildGeneratedDecisions(context.discovery, frontend, backend, documentation),
    learningsBlock: buildGeneratedLearnings(context.discovery, frontend, backend, documentation, navigation),
    tasksBlock: buildGeneratedTasks(context.discovery, frontend, backend, documentation, navigation, openQuestions),
    summary,
    openQuestions
  };
}

export async function writeContextLiteArtifacts(context: ProjectContext): Promise<ContextLiteResult> {
  const documents = await buildDocuments(context);
  const memoryDir = context.memoryDir;
  const reportPath = path.join(context.reportsDir, "context_lite.md");
  const artifactPaths = [
    path.join(memoryDir, "system_overview.md"),
    path.join(memoryDir, "domain_inventory.md"),
    path.join(memoryDir, "modules_map.md"),
    path.join(memoryDir, "frontend_architecture.md"),
    path.join(memoryDir, "backend_flows_and_contracts.md"),
    path.join(memoryDir, "ui_rules.md"),
    path.join(memoryDir, "MASTER_CONTEXT_PROMPT.md"),
    path.join(memoryDir, "DECISIONS.md"),
    path.join(memoryDir, "LEARNINGS.md"),
    path.join(memoryDir, "TASKS.md")
  ];

  await writeFileEnsured(path.join(memoryDir, "system_overview.md"), documents.systemOverview);
  await writeFileEnsured(path.join(memoryDir, "domain_inventory.md"), documents.domainInventory);
  await writeFileEnsured(path.join(memoryDir, "modules_map.md"), documents.modulesMap);
  await writeFileEnsured(path.join(memoryDir, "frontend_architecture.md"), documents.frontendArchitecture);
  await writeFileEnsured(path.join(memoryDir, "backend_flows_and_contracts.md"), documents.backendFlowsAndContracts);
  await writeFileEnsured(path.join(memoryDir, "ui_rules.md"), documents.uiRules);
  await writeFileEnsured(path.join(memoryDir, "MASTER_CONTEXT_PROMPT.md"), documents.masterContextPrompt);
  await upsertGeneratedSection(path.join(memoryDir, "DECISIONS.md"), "DECISIONS", documents.decisionsBlock);
  await upsertGeneratedSection(path.join(memoryDir, "LEARNINGS.md"), "LEARNINGS", documents.learningsBlock);
  await upsertGeneratedSection(path.join(memoryDir, "TASKS.md"), "TASKS", documents.tasksBlock);
  await writeFileEnsured(reportPath, buildSummaryReport(context, documents.summary, documents.openQuestions, artifactPaths));

  return {
    context,
    reportPath,
    artifactPaths,
    summary: documents.summary,
    openQuestions: documents.openQuestions
  };
}
