import path from "node:path";

import { BaseAgent } from "../base-agent";
import { readTextSafe } from "../../shared/fs-utils";

import type {
  AgentEvaluation,
  ProjectContext,
  SecurityCoverageStatus,
  SecurityFinding
} from "../../shared/types";

const DOCKERFILE_PATTERN = /(^|\/)Dockerfile$/i;
const COMPOSE_PATTERN = /(^|\/)docker-compose[^/]*\.ya?ml$/i;
const HEADER_SIGNAL_PATTERN = /(^|\/)(middleware|next\.config|server|helmet|headers?)\.(ts|tsx|js|jsx|mjs|cjs)$/i;

function pushFinding(
  target: SecurityFinding[],
  finding: SecurityFinding,
  findings: string[],
  recommendations: string[]
): void {
  target.push(finding);
  findings.push(`[${finding.severity.toUpperCase()}] ${finding.title}: ${finding.impact}`);
  recommendations.push(finding.fix);
}

export class InfraAgent extends BaseAgent {
  constructor() {
    super("infra-agent", "infra_security_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const securityFindings: SecurityFinding[] = [];
    const coverage: SecurityCoverageStatus[] = [];
    const dockerfiles = context.discovery.files.filter((filePath) => DOCKERFILE_PATTERN.test(filePath));
    const composeFiles = context.discovery.files.filter((filePath) => COMPOSE_PATTERN.test(filePath));
    const headerSignals = context.discovery.files.filter((filePath) => HEADER_SIGNAL_PATTERN.test(filePath));

    for (const filePath of dockerfiles) {
      const content = await readTextSafe(path.join(context.targetPath, filePath));
      if (!/^\s*USER\s+/m.test(content)) {
        pushFinding(
          securityFindings,
          {
            area: "infra_config",
            severity: "medium",
            title: "Contenedor sin usuario no-root explícito",
            location: filePath,
            evidence: "No se detectó instrucción `USER` en el Dockerfile inspeccionado.",
            attackVector: [
              "Una vulnerabilidad en la app o dependencia permite ejecución dentro del contenedor.",
              "El proceso corre como root por defecto.",
              "El atacante amplía el impacto del compromiso dentro del runtime o volúmenes montados."
            ],
            impact: "Mayor severidad de compromisos dentro del contenedor y menor hardening por defecto en producción.",
            fix: "Agregar un usuario dedicado y cambiar a él antes del entrypoint, por ejemplo: `RUN addgroup -S app && adduser -S app -G app` seguido de `USER app`.",
            references: ["CWE-250", "OWASP A05:2021", "ASVS 14.4.1"],
            effort: "low",
            problemType: "configuration",
            agentId: this.agentId
          },
          findings,
          recommendations
        );
      }
    }

    for (const filePath of composeFiles) {
      const content = await readTextSafe(path.join(context.targetPath, filePath));
      if (/privileged\s*:\s*true/i.test(content)) {
        pushFinding(
          securityFindings,
          {
            area: "infra_config",
            severity: "high",
            title: "Servicio Docker Compose con modo privilegiado",
            location: filePath,
            evidence: "Se detectó `privileged: true` en la configuración de Compose.",
            attackVector: [
              "Un atacante compromete el proceso dentro del contenedor privilegiado.",
              "Obtiene capacidades ampliadas sobre el host.",
              "Escala el compromiso fuera del contenedor."
            ],
            impact: "Aumento fuerte del blast radius entre contenedor y host.",
            fix: "Eliminar `privileged: true` y otorgar solo capacidades mínimas imprescindibles mediante `cap_add` específico o rediseño del servicio.",
            references: ["CWE-250", "OWASP A05:2021", "ASVS 14.4.1"],
            effort: "medium",
            problemType: "configuration",
            agentId: this.agentId
          },
          findings,
          recommendations
        );
      }

      if (/\/var\/run\/docker\.sock/i.test(content)) {
        pushFinding(
          securityFindings,
          {
            area: "infra_config",
            severity: "high",
            title: "Montaje de Docker socket dentro del contenedor",
            location: filePath,
            evidence: "Se detectó referencia a `/var/run/docker.sock` en la configuración revisada.",
            attackVector: [
              "El atacante compromete el contenedor con acceso al socket.",
              "Controla el daemon Docker del host.",
              "Crea o manipula contenedores adicionales con privilegios del host."
            ],
            impact: "Control casi total del host Docker desde un contenedor comprometido.",
            fix: "Eliminar el montaje del socket y reemplazarlo por un servicio intermedio o API con permisos mínimos específicos.",
            references: ["CWE-732", "OWASP A05:2021", "ASVS 14.4.1"],
            effort: "medium",
            problemType: "configuration",
            agentId: this.agentId
          },
          findings,
          recommendations
        );
      }
    }

    coverage.push({
      area: "http_headers",
      status: headerSignals.length > 0 ? "ok" : "not-reviewed",
      note:
        headerSignals.length > 0
          ? `Se detectaron puntos de configuración potencial para headers en: ${headerSignals.slice(0, 6).join(", ")}`
          : "No se confirmó una capa explícita de configuración de security headers; verificar middleware, reverse proxy o plataforma de despliegue.",
      agentId: this.agentId
    });

    coverage.push({
      area: "infra_config",
      status: securityFindings.some((entry) => entry.area === "infra_config")
        ? "finding"
        : dockerfiles.length > 0 || composeFiles.length > 0 || context.discovery.infrastructure.length > 0
          ? "ok"
          : "not-reviewed",
      note:
        dockerfiles.length > 0 || composeFiles.length > 0 || context.discovery.infrastructure.length > 0
          ? `Superficie de infraestructura revisada: ${[...dockerfiles, ...composeFiles, ...context.discovery.infraFiles].slice(0, 8).join(", ") || context.discovery.infrastructure.join(", ")}`
          : "No se detectó infraestructura local suficiente para revisar hardening de contenedores o despliegue.",
      agentId: this.agentId
    });

    coverage.push({
      area: "web_attacks",
      status: "not-reviewed",
      note: "InfraAgent no confirmó mitigaciones de SSRF, CSRF o XSS desde proxy o plataforma; revisar backend, middleware y frontend por separado.",
      agentId: this.agentId
    });

    return {
      title: "Infra Security Report",
      summary: "InfraAgent revisó hardening de contenedores, Compose y señales de configuración de headers para detectar riesgos de despliegue.",
      findings,
      recommendations,
      riskLevel: securityFindings.some((entry) => entry.severity === "high")
        ? "high"
        : securityFindings.some((entry) => entry.severity === "medium")
          ? "medium"
          : "low",
      securityFindings,
      coverage
    };
  }
}
