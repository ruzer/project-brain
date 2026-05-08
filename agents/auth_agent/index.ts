import path from "node:path";

import { BaseAgent } from "../base-agent";
import { readTextSafe } from "../../shared/fs-utils";

import type {
  AgentEvaluation,
  ProjectContext,
  SecurityCoverageStatus,
  SecurityFinding
} from "../../shared/types";

const AUTH_FILE_PATTERN = /(^|\/)(auth|session|permissions?|roles?|access|acl|rbac|middleware).*\.(ts|tsx|js|jsx)$/i;
const AUTH_ROUTE_PATTERN = /(^|\/)(src\/)?app\/api\/auth\/.+\/route\.(ts|tsx|js|jsx)$/i;

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

function extractSnippet(content: string, pattern: RegExp): string {
  const match = content.match(pattern);
  if (!match?.[0]) {
    return "No se pudo extraer un fragmento corto adicional.";
  }

  return match[0].replace(/\s+/g, " ").trim();
}

export class AuthAgent extends BaseAgent {
  constructor() {
    super("auth-agent", "auth_security_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const securityFindings: SecurityFinding[] = [];
    const coverage: SecurityCoverageStatus[] = [];
    const authFiles = context.discovery.files.filter((filePath) => AUTH_FILE_PATTERN.test(filePath)).slice(0, 24);
    const authRoutes = context.discovery.files.filter((filePath) => AUTH_ROUTE_PATTERN.test(filePath)).slice(0, 12);
    const authorizationFiles = authFiles.filter((filePath) => /permissions?|roles?|access|acl|rbac/i.test(filePath));

    for (const filePath of authFiles) {
      const absolutePath = path.join(context.targetPath, filePath);
      const content = await readTextSafe(absolutePath);

      if (
        /return\s*{\s*[^}]*\bid\s*:\s*["'`][^"'`]+["'`][^}]*\brole\s*:\s*["'`][^"'`]+["'`][^}]*}/is.test(content) &&
        /session|auth/i.test(filePath)
      ) {
        pushFinding(
          securityFindings,
          {
            area: "auth_sessions",
            severity: "high",
            title: "Contexto de sesión autenticada hardcodeado",
            location: filePath,
            evidence: `Fragmento detectado: ${extractSnippet(content, /return\s*{[\s\S]*?}/i)}`,
            attackVector: [
              "Una ruta del backend consume el helper de sesión comprometido.",
              "La función entrega un usuario o rol fijo sin verificar credenciales.",
              "El atacante obtiene contexto autenticado o privilegios sin validación real."
            ],
            impact: "Bypass de autenticación y decisiones de autorización basadas en identidad simulada o fija.",
            fix: "Reemplazar el helper por lectura de sesión real desde cookie/JWT verificado y devolver `null` cuando no exista una sesión válida.",
            references: ["CWE-287", "OWASP A07:2021", "ASVS 3.2.2"],
            effort: "medium",
            problemType: "code",
            agentId: this.agentId
          },
          findings,
          recommendations
        );
      }

      if (/(localStorage|sessionStorage)\.(setItem|getItem)\([^)]*(token|session|auth)/i.test(content)) {
        pushFinding(
          securityFindings,
          {
            area: "auth_sessions",
            severity: "medium",
            title: "Token o sesión accesible desde Web Storage",
            location: filePath,
            evidence: `Fragmento detectado: ${extractSnippet(content, /(localStorage|sessionStorage)\.(setItem|getItem)\([^)]*\)/i)}`,
            attackVector: [
              "El atacante consigue ejecutar JavaScript en el navegador (por XSS o script de tercero).",
              "Lee el token almacenado en Web Storage.",
              "Reutiliza el token para secuestrar sesión o llamar APIs."
            ],
            impact: "Mayor exposición de sesiones o JWT frente a XSS del lado cliente.",
            fix: "Mover las credenciales de sesión a cookies `httpOnly`, `Secure` y `SameSite` apropiadas, evitando almacenar tokens sensibles en `localStorage` o `sessionStorage`.",
            references: ["CWE-922", "OWASP A07:2021", "ASVS 3.4.2"],
            effort: "medium",
            problemType: "code",
            agentId: this.agentId
          },
          findings,
          recommendations
        );
      }

      if (/process\.env\.[A-Z0-9_]+\s*\|\|\s*["'`][^"'`]+["'`]/i.test(content) && /(jwt|token|secret|session|auth)/i.test(content)) {
        pushFinding(
          securityFindings,
          {
            area: "auth_sessions",
            severity: "high",
            title: "Secreto de sesión con fallback hardcodeado",
            location: filePath,
            evidence: `Fragmento detectado: ${extractSnippet(content, /process\.env\.[A-Z0-9_]+\s*\|\|\s*["'`][^"'`]+["'`]/i)}`,
            attackVector: [
              "El despliegue carece de la variable esperada.",
              "La aplicación cae al secreto hardcodeado o predecible.",
              "Un atacante firma o verifica tokens con el valor conocido."
            ],
            impact: "Compromiso de integridad de sesiones o JWT cuando el entorno no inyecta el secreto correcto.",
            fix: "Eliminar el fallback hardcodeado y abortar el arranque si falta la variable de entorno crítica de autenticación.",
            references: ["CWE-798", "OWASP A07:2021", "ASVS 3.5.3"],
            effort: "low",
            problemType: "code+configuration",
            agentId: this.agentId
          },
          findings,
          recommendations
        );
      }
    }

    coverage.push({
      area: "auth_sessions",
      status:
        securityFindings.some((entry) => entry.area === "auth_sessions")
          ? "finding"
          : authFiles.length > 0 || authRoutes.length > 0
            ? "ok"
            : "not-reviewed",
      note:
        authFiles.length > 0 || authRoutes.length > 0
          ? `Se revisaron señales de sesión/auth en: ${[...authRoutes, ...authFiles].slice(0, 6).join(", ")}`
          : "No se confirmaron módulos de sesión o auth suficientes para revisar el manejo real de sesiones.",
      agentId: this.agentId
    });

    coverage.push({
      area: "authorization",
      status:
        authorizationFiles.length === 0
          ? "not-reviewed"
          : securityFindings.some((entry) => entry.area === "authorization")
            ? "finding"
            : "ok",
      note:
        authorizationFiles.length > 0
          ? `Se detectaron controles o helpers de permisos en: ${authorizationFiles.slice(0, 6).join(", ")}`
          : "No se confirmaron archivos suficientes de permisos/roles para revisar IDOR o escalación horizontal/vertical con detalle.",
      agentId: this.agentId
    });

    return {
      title: "Auth Security Report",
      summary: "AuthAgent revisó sesión, permisos y señales de autenticación/autorización para detectar bypasses evidentes y zonas no revisadas.",
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
