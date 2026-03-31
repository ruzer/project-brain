import path from "node:path";

import { uniqueSorted, writeFileEnsured, writeJsonEnsured } from "../../shared/fs-utils";

import type {
  AgentReport,
  ContextLiteResult,
  GovernanceSummary,
  ProjectContext,
  SecurityAuditArea,
  SecurityAuditResult,
  SecurityCoverageStatus,
  SecurityFinding,
  SecurityFindingSeverity,
  VerifiedAppContext
} from "../../shared/types";

const REQUIRED_AREAS: SecurityAuditArea[] = [
  "auth_sessions",
  "authorization",
  "input_validation",
  "web_attacks",
  "http_headers",
  "infra_config",
  "abuse_protection",
  "sensitive_data",
  "observability"
];

const AREA_LABELS: Record<SecurityAuditArea, string> = {
  auth_sessions: "Autenticación y sesiones",
  authorization: "Autorización",
  input_validation: "Validación de inputs",
  web_attacks: "Protección contra ataques web",
  http_headers: "Headers HTTP",
  infra_config: "Configuración e infraestructura",
  abuse_protection: "Protección contra abuso",
  sensitive_data: "Datos sensibles",
  observability: "Observabilidad y trazabilidad"
};

const SEVERITY_ORDER: Record<SecurityFindingSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

const SEVERITY_LABELS: Record<SecurityFindingSeverity, string> = {
  critical: "🔴 CRITICAL",
  high: "🟠 HIGH",
  medium: "🟡 MEDIUM",
  low: "🟢 LOW",
  info: "🔵 INFO"
};

function flattenDependencies(context: ProjectContext): string[] {
  return uniqueSorted(
    context.discovery.dependencies.flatMap((manifest) => manifest.dependencies.map((dependency) => dependency.toLowerCase()))
  );
}

function pickMany(files: string[], pattern: RegExp, limit: number): string[] {
  return files.filter((filePath) => pattern.test(filePath)).slice(0, limit);
}

function detectDataSignals(context: ProjectContext, flatDependencies: string[]): string[] {
  const signals: string[] = [];
  if (flatDependencies.some((dependency) => dependency.includes("prisma"))) {
    signals.push("Prisma");
  }
  if (flatDependencies.some((dependency) => dependency.includes("postgres"))) {
    signals.push("PostgreSQL");
  }
  if (flatDependencies.some((dependency) => dependency.includes("mysql"))) {
    signals.push("MySQL");
  }
  if (flatDependencies.some((dependency) => dependency.includes("mongo"))) {
    signals.push("MongoDB");
  }
  if (context.discovery.files.some((filePath) => /schema\.prisma$/i.test(filePath))) {
    signals.push("Prisma schema");
  }
  if (context.discovery.files.some((filePath) => /migration/i.test(filePath))) {
    signals.push("Migraciones versionadas");
  }
  return uniqueSorted(signals);
}

function detectStorageSignals(context: ProjectContext, flatDependencies: string[]): string[] {
  const signals: string[] = [];
  if (flatDependencies.some((dependency) => /minio|s3|@aws-sdk|storage/i.test(dependency))) {
    signals.push("Object storage SDK");
  }
  const fileMatches = pickMany(context.discovery.files, /(storage|bucket|uploads?|media|assets|blob)/i, 8);
  if (fileMatches.length > 0) {
    signals.push(...fileMatches);
  }
  return uniqueSorted(signals);
}

function detectAuthSignals(context: ProjectContext, flatDependencies: string[]): string[] {
  const signals: string[] = [];
  if (flatDependencies.some((dependency) => /(next-auth|auth0|clerk|lucia|jsonwebtoken|passport|express-session)/i.test(dependency))) {
    signals.push("Dependencias de auth/sesión");
  }
  signals.push(...pickMany(context.discovery.files, /(^|\/)(auth|session|permissions?|roles?|access|acl|rbac)/i, 8));
  return uniqueSorted(signals);
}

function detectEndpointSurfaces(context: ProjectContext): string[] {
  return uniqueSorted(
    [
      ...pickMany(context.discovery.files, /(^|\/)(src\/)?app\/api\/.+\/route\.(ts|tsx|js|jsx)$/i, 12),
      ...pickMany(context.discovery.files, /(^|\/)(src\/)?pages\/api\/.+\.(ts|tsx|js|jsx)$/i, 8),
      ...pickMany(context.discovery.files, /(^|\/)(routes|controllers|api)\//i, 8)
    ].slice(0, 16)
  );
}

function detectAttackSurface(context: ProjectContext): {
  publicEndpoints: string[];
  forms: string[];
  uploads: string[];
  privateDashboards: string[];
  adminPanels: string[];
  webhooks: string[];
  integrations: string[];
  storage: string[];
} {
  return {
    publicEndpoints: detectEndpointSurfaces(context),
    forms: pickMany(context.discovery.files, /(login|signup|register|form|checkout|profile)/i, 8),
    uploads: pickMany(context.discovery.files, /(upload|avatar|media|file|blob)/i, 8),
    privateDashboards: pickMany(context.discovery.files, /(dashboard|vendor|backoffice|private)/i, 8),
    adminPanels: pickMany(context.discovery.files, /(^|\/)(admin|administrator|moderation)/i, 8),
    webhooks: pickMany(context.discovery.files, /(webhook|hooks)/i, 8),
    integrations: pickMany(context.discovery.files, /(integrations?|clients?|adapters?|stripe|slack|twilio|sendgrid|s3|aws)/i, 8),
    storage: pickMany(context.discovery.files, /(storage|bucket|uploads?|media|assets|blob)/i, 8)
  };
}

function buildVerifiedContext(
  context: ProjectContext,
  contextLite: ContextLiteResult,
  scopeNote?: string
): VerifiedAppContext {
  const flatDependencies = flattenDependencies(context);
  const dataSignals = detectDataSignals(context, flatDependencies);
  const authSignals = detectAuthSignals(context, flatDependencies);
  const storageSignals = detectStorageSignals(context, flatDependencies);
  const attackSurface = detectAttackSurface(context);

  const architectureSummary = [
    `Framework real en runtime: ${context.discovery.frameworks.join(", ") || "Pendiente de confirmar"}.`,
    `Frontend/backend servidos por: ${context.discovery.apis.join(", ") || "sin API confirmada"}; infraestructura detectada=${context.discovery.infrastructure.join(", ") || "sin infraestructura explícita"}.`,
    `Base de datos o capa de datos: ${dataSignals.join(", ") || "No confirmada"}.`,
    `Storage: ${storageSignals.join(", ") || "No confirmado"}.`,
    `Manejo de sesiones o auth: ${authSignals.join(", ") || "No confirmado"}.`,
    `Exposición operativa observada: CI=${context.discovery.ci.providers.join(", ") || "sin CI confirmada"}, logging=${context.discovery.logging.frameworks.join(", ") || "sin logging dedicado"}, métricas=${context.discovery.metrics.tools.join(", ") || "sin métricas confirmadas"}.`,
    ...(scopeNote ? [scopeNote] : [])
  ];

  const criticalAssets = uniqueSorted([
    authSignals.length > 0 ? "Sesiones, identidad autenticada y decisiones de autorización" : "",
    dataSignals.length > 0 ? `Datos persistidos y modelos de negocio (${dataSignals.join(", ")})` : "",
    storageSignals.length > 0 ? `Archivos y blobs potencialmente sensibles (${storageSignals.join(", ")})` : "",
    context.discovery.files.some((filePath) => /(^|\/)\.env($|[^/])|\.pem$|\.key$/i.test(filePath)) ? "Secretos, llaves o configuración sensible en archivos del repo" : "",
    attackSurface.privateDashboards.length > 0 ? "Dashboards privados y privilegios de operador/admin" : "",
    context.discovery.logging.frameworks.length > 0 || context.discovery.metrics.tools.length > 0 ? "Logs, trazas y telemetría operacional" : ""
  ].filter(Boolean));

  const trustBoundaries = uniqueSorted([
    attackSurface.publicEndpoints.length > 0 ? `Código servidor expuesto en rutas/endpoints: ${attackSurface.publicEndpoints.slice(0, 6).join(", ")}` : "",
    attackSurface.privateDashboards.length > 0 ? `Código cliente en dashboards privados: ${attackSurface.privateDashboards.slice(0, 6).join(", ")}` : "",
    authSignals.length > 0 ? `Decisiones de auth/authz aparentes en: ${authSignals.slice(0, 6).join(", ")}` : "",
    attackSurface.forms.length > 0 ? `Entradas no confiables visibles en formularios o páginas: ${attackSurface.forms.slice(0, 6).join(", ")}` : "",
    attackSurface.integrations.length > 0 ? `Integraciones y conectores externos: ${attackSurface.integrations.slice(0, 6).join(", ")}` : ""
  ].filter(Boolean));

  return {
    architectureSummary,
    attackSurface: uniqueSorted([
      attackSurface.publicEndpoints.length > 0 ? `Endpoints públicos o handlers: ${attackSurface.publicEndpoints.join(", ")}` : "",
      attackSurface.forms.length > 0 ? `Formularios o superficies de entrada: ${attackSurface.forms.join(", ")}` : "",
      attackSurface.uploads.length > 0 ? `Uploads o manejo de archivos: ${attackSurface.uploads.join(", ")}` : "",
      attackSurface.privateDashboards.length > 0 ? `Dashboards privados: ${attackSurface.privateDashboards.join(", ")}` : "",
      attackSurface.adminPanels.length > 0 ? `Admin panels: ${attackSurface.adminPanels.join(", ")}` : "",
      attackSurface.webhooks.length > 0 ? `Webhooks: ${attackSurface.webhooks.join(", ")}` : "",
      attackSurface.integrations.length > 0 ? `Integraciones externas: ${attackSurface.integrations.join(", ")}` : "",
      attackSurface.storage.length > 0 ? `Buckets/storage accesible o referido: ${attackSurface.storage.join(", ")}` : ""
    ].filter(Boolean)),
    criticalAssets,
    trustBoundaries,
    contextGaps: uniqueSorted(contextLite.openQuestions).slice(0, 12)
  };
}

function mergeCoverage(agentReports: AgentReport[]): SecurityCoverageStatus[] {
  const byArea = new Map<SecurityAuditArea, SecurityCoverageStatus[]>();
  for (const report of agentReports) {
    for (const entry of report.coverage ?? []) {
      byArea.set(entry.area, [...(byArea.get(entry.area) ?? []), entry]);
    }
  }

  return REQUIRED_AREAS.map((area) => {
    const entries = byArea.get(area) ?? [];
    if (entries.some((entry) => entry.status === "finding")) {
      return {
        area,
        status: "finding" as const,
        note: uniqueSorted(entries.map((entry) => entry.note)).join(" | "),
        agentId: entries.find((entry) => entry.status === "finding")?.agentId
      };
    }
    if (entries.some((entry) => entry.status === "ok")) {
      return {
        area,
        status: "ok" as const,
        note: uniqueSorted(entries.map((entry) => entry.note)).join(" | "),
        agentId: entries.find((entry) => entry.status === "ok")?.agentId
      };
    }
    return {
      area,
      status: "not-reviewed" as const,
      note: `No revisado — se requiere acceso adicional o detectores específicos para ${AREA_LABELS[area].toLowerCase()}.`
    };
  });
}

function sortFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return [...findings].sort((left, right) => {
    const severityDiff = SEVERITY_ORDER[right.severity] - SEVERITY_ORDER[left.severity];
    if (severityDiff !== 0) {
      return severityDiff;
    }
    return left.title.localeCompare(right.title);
  });
}

function deriveVerdict(findings: SecurityFinding[], coverage: SecurityCoverageStatus[]): SecurityAuditResult["verdict"] {
  const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
  const highCount = findings.filter((finding) => finding.severity === "high").length;
  const notReviewedCount = coverage.filter((entry) => entry.status === "not-reviewed").length;

  if (criticalCount > 0 || highCount >= 2) {
    return "No apta para producción";
  }
  if (highCount > 0 || findings.some((finding) => finding.severity === "medium") || notReviewedCount >= 3) {
    return "Apta con remediaciones obligatorias";
  }
  return "Apta con hardening recomendado";
}

function summarizeExecutive(
  verifiedContext: VerifiedAppContext,
  findings: SecurityFinding[],
  verdict: SecurityAuditResult["verdict"]
): string[] {
  const primarySurface = verifiedContext.attackSurface[0] ?? "Superficie principal no confirmada";
  const highestFinding = findings[0];
  const state =
    findings.length === 0
      ? "No se confirmaron hallazgos explotables de alta severidad con la evidencia disponible."
      : `Hallazgo más crítico: ${SEVERITY_LABELS[highestFinding.severity]} ${highestFinding.title}.`;

  return [
    `Superficie de ataque principal: ${primarySurface}`,
    state,
    `Estado general: ${findings.length} hallazgos estructurados y ${verifiedContext.contextGaps.length} huecos de contexto abiertos.`,
    `Producción: ${verdict}`
  ];
}

function renderCoverage(coverage: SecurityCoverageStatus[]): string {
  return coverage
    .map((entry) => {
      if (entry.status === "ok") {
        return `- ✅ ${AREA_LABELS[entry.area]}: implementación correcta — ${entry.note}`;
      }
      if (entry.status === "finding") {
        return `- ⚠️ ${AREA_LABELS[entry.area]}: requiere remediación — ${entry.note}`;
      }
      return `- No revisado — se requiere acceso a ${AREA_LABELS[entry.area].toLowerCase()} o detectores más específicos. ${entry.note}`;
    })
    .join("\n");
}

function renderFinding(finding: SecurityFinding): string {
  return `---
**${SEVERITY_LABELS[finding.severity]} — ${finding.title}**
- **Ubicación**: ${finding.location}
- **Evidencia**: ${finding.evidence}
- **Vector de ataque**: ${finding.attackVector.join(" -> ")}
- **Impacto real**: ${finding.impact}
- **Fix**: ${finding.fix}
- **Referencias**: ${finding.references.join(" / ")}
---`;
}

function renderPriorityTable(findings: SecurityFinding[]): string {
  if (findings.length === 0) {
    return "| # | Severidad | Vulnerabilidad | Ubicación | Esfuerzo de fix | Impacto |\n| --- | --- | --- | --- | --- | --- |\n| 1 | INFO | Sin hallazgos estructurados confirmados | N/A | low | Sin impacto explotable confirmado con la evidencia disponible |";
  }

  return [
    "| # | Severidad | Vulnerabilidad | Ubicación | Esfuerzo de fix | Impacto |",
    "| --- | --- | --- | --- | --- | --- |",
    ...findings.map(
      (finding, index) =>
        `| ${index + 1} | ${SEVERITY_LABELS[finding.severity]} | ${finding.title} | ${finding.location.replace(/\|/g, "\\|")} | ${finding.effort} | ${finding.impact.replace(/\|/g, "\\|")} |`
    )
  ].join("\n");
}

function deriveChecklist(findings: SecurityFinding[], coverage: SecurityCoverageStatus[]): string[] {
  const lowEffort = findings.filter((finding) => finding.effort === "low");
  const mediumEffort = findings.filter((finding) => finding.effort === "medium");
  const highImpact = findings.filter((finding) => finding.severity === "critical" || finding.severity === "high");
  const unresolvedCoverage = coverage.filter((entry) => entry.status === "not-reviewed");

  return uniqueSorted([
    ...lowEffort.map((finding) => `Fix rápido: ${finding.title} en ${finding.location}.`),
    ...highImpact.map((finding) => `Impacto alto: remediar ${finding.title} (${finding.location}) antes de exponer la app a tráfico real.`),
    ...mediumEffort.map((finding) => `Deuda técnica inmediata: aplicar el fix propuesto para ${finding.title}.`),
    ...unresolvedCoverage.map((entry) => `Cerrar hueco de revisión en ${AREA_LABELS[entry.area].toLowerCase()}.`)
  ]).slice(0, 14);
}

function deriveSecurityDebt(
  coverage: SecurityCoverageStatus[],
  verifiedContext: VerifiedAppContext
): string[] {
  return uniqueSorted([
    ...coverage
      .filter((entry) => entry.status === "not-reviewed")
      .map((entry) => `Completar revisiones estructuradas y detectores dedicados para ${AREA_LABELS[entry.area].toLowerCase()}.`),
    verifiedContext.trustBoundaries.length === 0
      ? "Separar explícitamente decisiones de seguridad de frontend y backend para reducir controles implícitos."
      : "",
    verifiedContext.contextGaps.length > 0
      ? "Resolver huecos de contexto canónico antes de declarar la superficie como lista para producción."
      : "",
    "Formalizar una política de hardening, logging de seguridad y ownership por capa (auth, infra, storage, observability)."
  ].filter(Boolean)).slice(0, 12);
}

function countBySeverity(findings: SecurityFinding[]): Record<SecurityFindingSeverity, number> {
  return findings.reduce<Record<SecurityFindingSeverity, number>>(
    (accumulator, finding) => {
      accumulator[finding.severity] += 1;
      return accumulator;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  );
}

function buildHeadline(findings: SecurityFinding[], verdict: SecurityAuditResult["verdict"]): string {
  const counts = countBySeverity(findings);
  return `Security audit completo: critical=${counts.critical}, high=${counts.high}, medium=${counts.medium}, low=${counts.low}, info=${counts.info}; verdict=${verdict}.`;
}

function renderReport(
  result: SecurityAuditResult,
  executiveSummary: string[]
): string {
  return `# Security Audit

### 1. Resumen ejecutivo
${executiveSummary.map((line) => `- ${line}`).join("\n")}

### 2. Contexto verificado de la app
- arquitectura real: ${result.verifiedContext.architectureSummary.join(" | ")}
- auth real: ${result.verifiedContext.architectureSummary.find((line) => line.startsWith("Manejo de sesiones")) ?? "No confirmado"}
- storage real: ${result.verifiedContext.architectureSummary.find((line) => line.startsWith("Storage")) ?? "No confirmado"}
- exposición real: ${result.verifiedContext.attackSurface.join(" | ") || "No confirmada"}
- módulos no revisados: ${result.verifiedContext.contextGaps.join(" | ") || "Ninguno"}

**Resumen de arquitectura verificada**
${result.verifiedContext.architectureSummary.map((line) => `- ${line}`).join("\n")}

**Superficie de ataque identificada**
${result.verifiedContext.attackSurface.length > 0 ? result.verifiedContext.attackSurface.map((line) => `- ${line}`).join("\n") : "- No se confirmó una superficie expuesta suficiente con la evidencia disponible."}

**Activos críticos**
${result.verifiedContext.criticalAssets.length > 0 ? result.verifiedContext.criticalAssets.map((line) => `- ${line}`).join("\n") : "- No se confirmaron activos críticos adicionales fuera de los patrones básicos del repositorio."}

**Módulos no revisados o con contexto insuficiente**
${result.verifiedContext.contextGaps.length > 0 ? result.verifiedContext.contextGaps.map((line) => `- ${line}`).join("\n") : "- Sin módulos marcados como no revisados en esta corrida."}

### 3. Hallazgos
${result.findings.length > 0 ? result.findings.map(renderFinding).join("\n\n") : "✅ No se confirmaron hallazgos explotables con la evidencia disponible en esta corrida."}

**Cobertura obligatoria**
${renderCoverage(result.coverage)}

### 4. Tabla de prioridades
${renderPriorityTable(result.findings)}

### 5. Checklist de producción
${result.checklist.length > 0 ? result.checklist.map((line) => `- ${line}`).join("\n") : "- No quedan fixes rápidos confirmados; aplicar hardening recomendado y cerrar huecos de contexto."}

### 6. Deuda de seguridad
${result.securityDebt.length > 0 ? result.securityDebt.map((line) => `- ${line}`).join("\n") : "- Sin deuda estructural adicional confirmada más allá del hardening continuo."}

### 7. Veredicto final
${result.verdict}
`;
}

export async function runSecurityAudit(
  context: ProjectContext,
  governanceRun: {
    agentReports: AgentReport[];
    summary: GovernanceSummary;
  },
  contextLite: ContextLiteResult,
  options: {
    trigger: SecurityAuditResult["trigger"];
    scopeNote?: string;
  }
): Promise<SecurityAuditResult> {
  const verifiedContext = buildVerifiedContext(context, contextLite, options.scopeNote);
  const findings = sortFindings(
    governanceRun.agentReports.flatMap((report) => report.securityFindings ?? [])
  );
  const coverage = mergeCoverage(governanceRun.agentReports);
  const verdict = deriveVerdict(findings, coverage);
  const checklist = deriveChecklist(findings, coverage);
  const securityDebt = deriveSecurityDebt(coverage, verifiedContext);
  const reportPath = path.join(context.reportsDir, "security_audit.md");
  const memoryPath = path.join(context.runtimeMemoryDir, "security", "security_audit.json");
  const sourceReports = governanceRun.agentReports.map((report) => report.outputPath);
  const headline = buildHeadline(findings, verdict);

  const result: SecurityAuditResult = {
    context,
    trigger: options.trigger,
    reportPath,
    memoryPath,
    contextLiteReportPath: contextLite.reportPath,
    verifiedContext,
    findings,
    coverage,
    checklist,
    securityDebt,
    sourceReports,
    verdict,
    headline
  };

  const executiveSummary = summarizeExecutive(verifiedContext, findings, verdict);

  await writeJsonEnsured(memoryPath, {
    trigger: result.trigger,
    headline: result.headline,
    verdict: result.verdict,
    verifiedContext: result.verifiedContext,
    findings: result.findings,
    coverage: result.coverage,
    checklist: result.checklist,
    securityDebt: result.securityDebt,
    sourceReports: result.sourceReports,
    contextLiteReportPath: result.contextLiteReportPath,
    firewallReportPath: governanceRun.summary.firewall?.reportPath
  });
  await writeFileEnsured(reportPath, renderReport(result, executiveSummary));

  return result;
}
