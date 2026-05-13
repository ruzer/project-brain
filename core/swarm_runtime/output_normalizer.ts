import type { SwarmPlanTask } from "../../shared/types";

export interface PlannerPayload {
  overview: string;
  tasks: SwarmPlanTask[];
}

export interface WorkerPayload {
  summary: string;
  findings: string[];
  recommendations: string[];
  verifiedFacts: string[];
  unknowns: string[];
  evidenceRefs: string[];
}

export interface SynthesisPayload {
  headline: string;
  summary: string;
  priorities: string[];
  next_steps: string[];
  verified_facts: string[];
  unknowns: string[];
  evidence_refs: string[];
}

type StructuredSectionKey =
  | "body"
  | "headline"
  | "summary"
  | "findings"
  | "recommendations"
  | "priorities"
  | "next_steps"
  | "verified_facts"
  | "unknowns"
  | "evidence_refs";

function extractJsonObject(input: string): Record<string, unknown> | undefined {
  const trimmed = input.trim();
  const candidate = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
}

function stripCodeFences(input: string): string {
  return input
    .trim()
    .replace(/^```(?:json|markdown|md|text)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function normalizeSectionKey(rawKey: string): StructuredSectionKey | undefined {
  const normalized = rawKey.trim().toLowerCase().replace(/\s+/g, " ");

  if (normalized === "headline") {
    return "headline";
  }
  if (normalized === "summary" || normalized === "overview") {
    return "summary";
  }
  if (normalized === "findings" || normalized === "issues" || normalized === "risks" || normalized === "observations") {
    return "findings";
  }
  if (normalized === "recommendations" || normalized === "actions" || normalized === "action items") {
    return "recommendations";
  }
  if (normalized === "priorities") {
    return "priorities";
  }
  if (normalized === "next steps" || normalized === "next_steps" || normalized === "next-step" || normalized === "next step") {
    return "next_steps";
  }
  if (normalized === "verified facts" || normalized === "verified_facts" || normalized === "facts") {
    return "verified_facts";
  }
  if (normalized === "unknowns" || normalized === "unknown" || normalized === "not verified" || normalized === "not_verified") {
    return "unknowns";
  }
  if (normalized === "evidence refs" || normalized === "evidence_refs" || normalized === "evidence" || normalized === "sources") {
    return "evidence_refs";
  }

  return undefined;
}

function parseStructuredSections(input: string): Partial<Record<StructuredSectionKey, string[]>> {
  const cleaned = stripCodeFences(input);
  const sections: Partial<Record<StructuredSectionKey, string[]>> = {
    body: []
  };
  let currentSection: StructuredSectionKey = "body";

  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const headingMatch = line.match(/^(?:#{1,6}\s*)?([A-Za-z][A-Za-z _-]+?)(?::\s*(.*))?$/);
    const sectionKey = headingMatch ? normalizeSectionKey(headingMatch[1] ?? "") : undefined;
    if (sectionKey) {
      currentSection = sectionKey;
      sections[currentSection] ??= [];
      const inlineValue = headingMatch?.[2]?.trim();
      if (inlineValue) {
        sections[currentSection]!.push(inlineValue);
      }
      continue;
    }

    sections[currentSection] ??= [];
    sections[currentSection]!.push(line);
  }

  return sections;
}

function stripListPrefix(value: string): string {
  return value.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

function sectionToList(lines: string[] | undefined): string[] {
  if (!lines || lines.length === 0) {
    return [];
  }

  return lines
    .map((line) => stripListPrefix(line))
    .filter((line) => line.length > 0);
}

function sectionToText(lines: string[] | undefined): string {
  if (!lines || lines.length === 0) {
    return "";
  }

  return lines
    .map((line) => stripListPrefix(line))
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
}

function looksLikeCodeOnlyResponse(input: string): boolean {
  const cleaned = stripCodeFences(input);
  const lines = cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) {
    return false;
  }

  const hasStructuredSections = lines.some((line) => {
    const headingMatch = line.match(/^(?:#{1,6}\s*)?([A-Za-z][A-Za-z _-]+?)(?::\s*(.*))?$/);
    return Boolean(headingMatch && normalizeSectionKey(headingMatch[1] ?? ""));
  });
  if (hasStructuredSections) {
    return false;
  }

  const codeSignalCount = lines.filter((line) =>
    /^(?:#!|import\s+|from\s+\S+\s+import\s+|def\s+|class\s+|for\s+|while\s+|if\s+__name__|print\(|const\s+|let\s+|var\s+|function\s+|export\s+|package\s+main|use\s+|fn\s+)/.test(line) ||
    /[{};]$/.test(line)
  ).length;

  return codeSignalCount >= Math.max(3, Math.ceil(lines.length * 0.4));
}

function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function normalizeProfile(value: unknown): SwarmPlanTask["profile"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "worker" || normalized === "reviewer" || normalized === "reasoning" || normalized === "planner" || normalized === "synthesizer") {
    return normalized;
  }

  return undefined;
}

export function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))];
}

export function normalizeTaskDependencies(tasks: SwarmPlanTask[]): SwarmPlanTask[] {
  const validTaskIds = new Set(tasks.map((task) => task.taskId));

  return tasks.map((task) => {
    const dependsOn = uniqueStrings((task.dependsOn ?? []).filter((dependencyId) => dependencyId !== task.taskId && validTaskIds.has(dependencyId)));
    return dependsOn.length > 0
      ? {
          ...task,
          dependsOn
        }
      : {
          ...task,
          dependsOn: undefined
        };
  });
}

export function buildFallbackPlan(intent: string): PlannerPayload {
  return {
    overview: `This swarm run breaks the request into bounded repository scanning, risk review, and implementation reasoning for: ${intent}`,
    tasks: normalizeTaskDependencies([
      {
        taskId: "scan-scope",
        title: "Scan project scope",
        goal: "Identify the main stack, repo shape, and obvious hotspots tied to the request.",
        profile: "worker",
        deliverable: "Short scan of relevant modules and project characteristics."
      },
      {
        taskId: "review-risks",
        title: "Review critical risks",
        goal: "Surface concrete technical, security, or process risks related to the request.",
        profile: "reviewer",
        deliverable: "Findings and improvement recommendations.",
        dependsOn: ["scan-scope"]
      },
      {
        taskId: "reason-next-steps",
        title: "Reason about next steps",
        goal: "Turn the scan and risk review into practical next steps and tradeoffs.",
        profile: "reasoning",
        deliverable: "Decision-oriented next-step guidance.",
        dependsOn: ["scan-scope", "review-risks"]
      }
    ])
  };
}

export function normalizePlannerPayload(raw: string, intent: string): PlannerPayload {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return buildFallbackPlan(intent);
  }

  const tasks = Array.isArray(parsed.tasks)
    ? parsed.tasks
        .map((task, index): SwarmPlanTask | undefined => {
          if (!task || typeof task !== "object" || Array.isArray(task)) {
            return undefined;
          }

          const record = task as Record<string, unknown>;
          const title = typeof record.title === "string" ? record.title.trim() : "";
          const goal = typeof record.goal === "string" ? record.goal.trim() : "";
          const deliverable = typeof record.deliverable === "string" ? record.deliverable.trim() : "";
          const profile = normalizeProfile(record.profile) ?? (index === 0 ? "worker" : index === 1 ? "reviewer" : "reasoning");
          const dependsOn = normalizeStringList(record.dependsOn ?? record.depends_on);

          if (!title || !goal || !deliverable) {
            return undefined;
          }

          return {
            taskId: typeof record.taskId === "string" && record.taskId.trim().length > 0 ? record.taskId.trim() : `task-${index + 1}`,
            title,
            goal,
            profile,
            deliverable,
            dependsOn
          };
        })
        .filter((task): task is SwarmPlanTask => Boolean(task))
        .slice(0, 4)
    : [];

  if (tasks.length === 0) {
    return buildFallbackPlan(intent);
  }

  return {
    overview:
      typeof parsed.overview === "string" && parsed.overview.trim().length > 0
        ? parsed.overview.trim()
        : buildFallbackPlan(intent).overview,
    tasks: normalizeTaskDependencies(tasks)
  };
}

export function normalizeWorkerPayload(raw: string, task: SwarmPlanTask): WorkerPayload {
  const parsed = extractJsonObject(raw);
  if (parsed) {
    return {
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : `The ${task.title} worker finished without a summary.`,
      findings: normalizeStringList(parsed.findings),
      recommendations: normalizeStringList(parsed.recommendations),
      verifiedFacts: normalizeStringList(parsed.verified_facts ?? parsed.verifiedFacts),
      unknowns: normalizeStringList(parsed.unknowns),
      evidenceRefs: normalizeStringList(parsed.evidence_refs ?? parsed.evidenceRefs)
    };
  }

  const sections = parseStructuredSections(raw);
  const findings = sectionToList(sections.findings);
  const recommendations = sectionToList((sections.recommendations?.length ?? 0) > 0 ? sections.recommendations : sections.next_steps);
  const summary = sectionToText(sections.summary) || sectionToText(sections.body);

  if (
    summary &&
    findings.length === 0 &&
    recommendations.length === 0 &&
    sectionToList(sections.verified_facts).length === 0 &&
    sectionToList(sections.evidence_refs).length === 0 &&
    looksLikeCodeOnlyResponse(raw)
  ) {
    return {
      summary: `The ${task.title} worker returned code instead of structured analysis.`,
      findings: [],
      recommendations: ["Rerun this worker with a narrower analysis-only prompt or a stronger structured-output model."],
      verifiedFacts: [],
      unknowns: ["Worker response looked like generated code/script instead of evidence-backed analysis."],
      evidenceRefs: []
    };
  }

  if (summary || findings.length > 0 || recommendations.length > 0) {
    return {
      summary: summary || `The ${task.title} worker returned partial structured text.`,
      findings,
      recommendations,
      verifiedFacts: sectionToList(sections.verified_facts),
      unknowns: sectionToList(sections.unknowns),
      evidenceRefs: sectionToList(sections.evidence_refs)
    };
  }

  return {
    summary: `The ${task.title} worker could not return structured JSON.`,
    findings: [],
    recommendations: [],
    verifiedFacts: [],
    unknowns: [],
    evidenceRefs: []
  };
}

export function normalizeSynthesisPayload(raw: string, intent: string): SynthesisPayload {
  const parsed = extractJsonObject(raw);
  if (parsed) {
    return {
      headline:
        typeof parsed.headline === "string" && parsed.headline.trim().length > 0
          ? parsed.headline.trim()
          : `Completed a bounded swarm review for: ${intent}`,
      summary:
        typeof parsed.summary === "string" && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : "The swarm synthesized the delegated outputs.",
      priorities: normalizeStringList(parsed.priorities),
      next_steps: normalizeStringList(parsed.next_steps),
      verified_facts: normalizeStringList(parsed.verified_facts ?? parsed.verifiedFacts),
      unknowns: normalizeStringList(parsed.unknowns),
      evidence_refs: normalizeStringList(parsed.evidence_refs ?? parsed.evidenceRefs)
    };
  }

  const sections = parseStructuredSections(raw);
  const headline = sectionToText(sections.headline);
  const summary = sectionToText(sections.summary) || sectionToText(sections.body);
  const priorities = sectionToList(sections.priorities);
  const nextSteps = sectionToList((sections.next_steps?.length ?? 0) > 0 ? sections.next_steps : sections.recommendations);

  if (headline || summary || priorities.length > 0 || nextSteps.length > 0) {
    return {
      headline: headline || `Completed a bounded swarm review for: ${intent}`,
      summary: summary || "The swarm synthesized the delegated outputs.",
      priorities,
      next_steps: nextSteps,
      verified_facts: sectionToList(sections.verified_facts),
      unknowns: sectionToList(sections.unknowns),
      evidence_refs: sectionToList(sections.evidence_refs)
    };
  }

  return {
    headline: `Completed a bounded swarm review for: ${intent}`,
    summary: "The swarm finished, but synthesis did not return structured JSON.",
    priorities: [],
    next_steps: [],
    verified_facts: [],
    unknowns: [],
    evidence_refs: []
  };
}
