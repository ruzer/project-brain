import type { AskRoute, GovernanceTrigger } from "../../shared/types";

function includesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function followUpsFor(workflow: AskRoute["workflow"]): string[] {
  if (workflow === "resume-project") {
    return [
      "project-brain resume .",
      "project-brain status .",
      'project-brain ask "dime que le falta criticamente"',
      'project-brain ask "revisa los cambios recientes"'
    ];
  }

  if (workflow === "discover-project") {
    return [
      'project-brain ask "dime que le falta criticamente"',
      'project-brain swarm "ayudame a mejorar este repo"',
      "project-brain plan-improvements .",
      'project-brain ask "revisa los cambios recientes"',
      'project-brain ask "inspecciona el firewall y aprobaciones"'
    ];
  }

  if (workflow === "critical-gaps") {
    return [
      'project-brain swarm "ayudame a priorizar y mejorar este repo"',
      "project-brain plan-improvements .",
      'project-brain ask "revisa los cambios recientes"',
      'project-brain ask "inspecciona el firewall y aprobaciones"'
    ];
  }

  if (workflow === "review-latest-changes") {
    return [
      'project-brain ask "dime si el riesgo de estos cambios es alto"',
      'project-brain ask "muestrame el grafo de impacto"',
      'project-brain swarm "dame una segunda opinion sobre este repo"',
      'project-brain ask "dime que le falta criticamente"'
    ];
  }

  if (workflow === "inspect-firewall") {
    return [
      'project-brain ask "identifica este proyecto"',
      'project-brain ask "dime que le falta criticamente"',
      'project-brain swarm "proponme mejoras para este repo"',
      'project-brain ask "revisa los cambios recientes"'
    ];
  }

  return [
    'project-brain ask "revisa los cambios recientes"',
    'project-brain ask "dime que le falta criticamente"',
    'project-brain swarm "ayudame a mejorar este repo"',
    'project-brain ask "inspecciona el firewall y aprobaciones"'
  ];
}

function inferTrigger(normalizedIntent: string, fallback: GovernanceTrigger): GovernanceTrigger {
  if (/advisory|cve|vuln|vulnerabil/i.test(normalizedIntent)) {
    return "security-advisory";
  }

  if (/security|seguridad|secret|dependency|dependenc/i.test(normalizedIntent)) {
    return "security-audit";
  }

  if (/architecture|arquitectura|structural|refactor|boundary/i.test(normalizedIntent)) {
    return "architecture-review";
  }

  if (/incident|outage|falla|caida|degrad/i.test(normalizedIntent)) {
    return "incident-detection";
  }

  if (/change|cambio|diff|commit|pull request|pr\b|latest/i.test(normalizedIntent)) {
    return "repository-change";
  }

  return fallback;
}

export function routeIntent(intent: string): AskRoute {
  const normalizedIntent = intent.trim().toLowerCase();

  if (
    includesAny(normalizedIntent, [
      /\bresume\b/,
      /\bcontinue\b/,
      /\bretoma\b/,
      /\bcontinua\b/,
      /\bcontinuar\b/,
      /\bseguir\b/,
      /\bseguimos\b/,
      /where.*left off/,
      /donde nos quedamos/,
      /en que nos quedamos/
    ])
  ) {
    return {
      workflow: "resume-project",
      reason: "The request is about continuing from the latest saved project state.",
      trigger: "manual",
      followUps: followUpsFor("resume-project")
    };
  }

  if (
    includesAny(normalizedIntent, [
      /firewall/,
      /policy/,
      /approval/,
      /permissions?/,
      /permisos?/,
      /riesgo operativ/,
      /tool matrix/,
      /safe mode/,
      /aprobaciones?/
    ])
  ) {
    return {
      workflow: "inspect-firewall",
      reason: "The request is about approvals, permissions, or execution boundaries.",
      trigger: inferTrigger(normalizedIntent, "repository-change"),
      followUps: followUpsFor("inspect-firewall")
    };
  }

  if (
    includesAny(normalizedIntent, [
      /review/,
      /revisa/,
      /latest changes?/,
      /ultimos? cambios?/,
      /ultimo commit/,
      /diff/,
      /pull request/,
      /\bpr\b/,
      /delta/
    ])
  ) {
    return {
      workflow: "review-latest-changes",
      reason: "The request focuses on recent changes or bounded review context.",
      trigger: "repository-change",
      followUps: followUpsFor("review-latest-changes")
    };
  }

  if (
    includesAny(normalizedIntent, [
      /graph/,
      /grafo/,
      /dependencies?/,
      /dependencias/,
      /impact/,
      /blast radius/,
      /callers?/,
      /callees?/
    ])
  ) {
    return {
      workflow: "build-code-graph",
      reason: "The request asks for structural code relationships or impact context.",
      trigger: inferTrigger(normalizedIntent, "repository-change"),
      followUps: followUpsFor("build-code-graph")
    };
  }

  if (
    includesAny(normalizedIntent, [
      /critical/,
      /critic/,
      /que le falta/,
      /what.*missing/,
      /missing/,
      /riesgo/,
      /risk/,
      /security/,
      /seguridad/,
      /documentation/,
      /documentacion/,
      /deuda tecnica/,
      /technical debt/
    ])
  ) {
    return {
      workflow: "critical-gaps",
      reason: "The request asks for weaknesses, risks, or missing capabilities.",
      trigger: inferTrigger(normalizedIntent, "manual"),
      followUps: followUpsFor("critical-gaps")
    };
  }

  return {
    workflow: "discover-project",
    reason: "Defaulting to repository discovery because the request is exploratory or introductory.",
    trigger: "manual",
    followUps: followUpsFor("discover-project")
  };
}
