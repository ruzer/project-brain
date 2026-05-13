import { execFileSync } from "node:child_process";
import path from "node:path";

import { BaseAgent } from "../base-agent";
import { fileExists } from "../../shared/fs-utils";

import type {
  AgentEvaluation,
  ProjectContext,
  SecurityCoverageStatus,
  SecurityFinding
} from "../../shared/types";

const LOCKFILES = [
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "Cargo.lock"
];
export type SensitiveFileExposureCategory = "SECRET_TRACKED" | "SECRET_PRESENT_UNTRACKED" | "SECRET_IN_OUTPUT";

export interface SensitiveFileExposure {
  filePath: string;
  category: SensitiveFileExposureCategory;
  severity: SecurityFinding["severity"];
}

function normalizeRepoFile(filePath: string): string {
  return filePath.replace(/^\/+/, "").replace(/\\/g, "/");
}

export function isTrackedByGit(filePath: string, targetPath: string): boolean {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", normalizeRepoFile(filePath)], {
      cwd: targetPath,
      stdio: "ignore"
    });
    return true;
  } catch {
    return false;
  }
}

async function isCopiedToOutput(context: ProjectContext, filePath: string): Promise<boolean> {
  const normalized = normalizeRepoFile(filePath);
  const resolvedTarget = path.resolve(context.targetPath);
  const resolvedOutput = path.resolve(context.outputPath);

  if (resolvedTarget === resolvedOutput) {
    return false;
  }

  return fileExists(path.join(context.outputPath, normalized));
}

export async function classifySensitiveFileExposure(
  context: ProjectContext,
  filePath: string
): Promise<SensitiveFileExposure> {
  if (await isCopiedToOutput(context, filePath)) {
    return {
      filePath: normalizeRepoFile(filePath),
      category: "SECRET_IN_OUTPUT",
      severity: "medium"
    };
  }

  if (isTrackedByGit(filePath, context.targetPath)) {
    return {
      filePath: normalizeRepoFile(filePath),
      category: "SECRET_TRACKED",
      severity: "high"
    };
  }

  return {
    filePath: normalizeRepoFile(filePath),
    category: "SECRET_PRESENT_UNTRACKED",
    severity: "low"
  };
}

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

export class SecurityAgent extends BaseAgent {
  constructor() {
    super("security-agent", "security_report.md");
  }

  protected async evaluate(context: ProjectContext): Promise<AgentEvaluation> {
    const findings: string[] = [];
    const recommendations: string[] = [];
    const securityFindings: SecurityFinding[] = [];
    const coverage: SecurityCoverageStatus[] = [];
    const { discovery } = context;

    const riskyFiles = discovery.files.filter(
      (file) =>
        /(^|\/)\.env($|[^/])/.test(file) ||
        /\.(pem|key)$/i.test(file) ||
        /id_rsa|credentials|secret/i.test(file)
    ).filter((file) => !/\.example$|\.sample$|\.template$/i.test(file));

    const classifiedRiskyFiles = await Promise.all(
      riskyFiles.map((file) => classifySensitiveFileExposure(context, file))
    );
    const groupedRiskyFiles = classifiedRiskyFiles.reduce<Record<SensitiveFileExposureCategory, SensitiveFileExposure[]>>(
      (groups, exposure) => {
        groups[exposure.category].push(exposure);
        return groups;
      },
      {
        SECRET_TRACKED: [],
        SECRET_PRESENT_UNTRACKED: [],
        SECRET_IN_OUTPUT: []
      }
    );

    for (const [category, exposures] of Object.entries(groupedRiskyFiles) as Array<[SensitiveFileExposureCategory, SensitiveFileExposure[]]>) {
      if (exposures.length === 0) {
        continue;
      }
      const sample = exposures.map((entry) => entry.filePath).slice(0, 5);
      const severity = exposures.some((entry) => entry.severity === "high")
        ? "high"
        : exposures.some((entry) => entry.severity === "medium")
          ? "medium"
          : "low";
      const title =
        category === "SECRET_TRACKED"
          ? "SECRET_TRACKED: Secretos o material sensible versionado en el repositorio"
          : category === "SECRET_IN_OUTPUT"
            ? "SECRET_IN_OUTPUT: Archivo sensible copiado al output de análisis"
            : "SECRET_PRESENT_UNTRACKED: Archivo sensible presente pero no versionado";
      const evidence =
        category === "SECRET_TRACKED"
          ? `git ls-files confirma archivos sensibles versionados: ${sample.join(", ")}.`
          : category === "SECRET_IN_OUTPUT"
            ? `Se detectaron archivos sensibles en el directorio de output: ${sample.join(", ")}.`
            : `Se detectaron archivos sensibles presentes en working tree, pero git ls-files no los reporta como versionados: ${sample.join(", ")}.`;
      const impact =
        category === "SECRET_TRACKED"
          ? "Exposición de credenciales, secretos operativos o llaves privadas reutilizables."
          : category === "SECRET_IN_OUTPUT"
            ? "Los artefactos generados pueden transportar secretos fuera del repositorio objetivo."
            : "Riesgo local reducido: el secreto existe en el working tree, pero no hay evidencia de que esté versionado.";
      const fix =
        category === "SECRET_TRACKED"
          ? "Mover los secretos a un vault o variables de entorno del despliegue, rotarlos y agregar reglas de ignore para impedir nuevos commits sensibles."
          : category === "SECRET_IN_OUTPUT"
            ? "Eliminar secretos del output, rotarlos si el output fue compartido y agregar exclusiones para impedir copias futuras."
            : "Mantener el archivo en `.gitignore`, validar que no se copie a artefactos y usar `.env.example` sin valores reales.";

      pushFinding(
        securityFindings,
        {
          area: "sensitive_data",
          severity,
          title,
          location: sample.join(", "),
          evidence,
          attackVector: [
            "Un atacante obtiene acceso al repositorio o a un artefacto que lo replique.",
            "Lee el archivo sensible comprometido.",
            "Reutiliza secretos, claves o credenciales contra entornos reales."
          ],
          impact,
          fix,
          references: ["CWE-798", "OWASP A05:2021", "ASVS 8.1.1"],
          effort: "medium",
          problemType: "configuration",
          agentId: this.agentId
        },
        findings,
        recommendations
      );
    }

    if (classifiedRiskyFiles.length > 0) {
      coverage.push({
        area: "sensitive_data",
        status: "finding",
        note: `Archivos sensibles confirmados: ${classifiedRiskyFiles.map((entry) => `${entry.filePath} (${entry.category})`).slice(0, 5).join(", ")}`,
        agentId: this.agentId
      });
    } else {
      coverage.push({
        area: "sensitive_data",
        status: "ok",
        note: "No se confirmaron archivos de secretos versionados con patrones directos en el escaneo del repositorio.",
        agentId: this.agentId
      });
    }

    if (discovery.dependencies.length > 0 && !LOCKFILES.some((lockfile) => discovery.files.includes(lockfile))) {
      pushFinding(
        securityFindings,
        {
          area: "infra_config",
          severity: "medium",
          title: "Dependencias sin lockfile versionado",
          location: discovery.manifests.slice(0, 5).join(", ") || "package manifests",
          evidence: `Se detectaron manifests de dependencias sin lockfile asociado. Manifests: ${discovery.manifests.join(", ") || "desconocidos"}.`,
          attackVector: [
            "Una instalación futura resuelve versiones diferentes a las evaluadas.",
            "Se incorpora una versión vulnerable o maliciosa.",
            "El entorno ejecuta código distinto al revisado."
          ],
          impact: "Menor reproducibilidad y mayor riesgo de supply-chain drift en build o runtime.",
          fix: "Generar y versionar el lockfile correspondiente (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, etc.) para fijar resoluciones reproducibles.",
          references: ["CWE-1104", "OWASP A06:2021", "ASVS 14.2.1"],
          effort: "low",
          problemType: "configuration",
          agentId: this.agentId
        },
        findings,
        recommendations
      );
    }

    if (discovery.infrastructure.includes("Dockerfile") && !discovery.files.includes(".dockerignore")) {
      pushFinding(
        securityFindings,
        {
          area: "infra_config",
          severity: "low",
          title: "Dockerfile sin `.dockerignore` defensivo",
          location: "Dockerfile",
          evidence: "Se detectó Dockerfile pero no `.dockerignore` en la raíz del repositorio.",
          attackVector: [
            "El build context incluye archivos innecesarios o sensibles.",
            "La imagen copia contenido no destinado a runtime.",
            "Datos internos terminan dentro del artefacto desplegado."
          ],
          impact: "Mayor riesgo de filtración de secretos, metadata del repo o artefactos internos dentro de imágenes.",
          fix: "Agregar `.dockerignore` para excluir secretos, `.git`, `node_modules`, salidas de build y archivos locales no destinados a imagen.",
          references: ["CWE-668", "OWASP A05:2021", "ASVS 14.4.3"],
          effort: "low",
          problemType: "configuration",
          agentId: this.agentId
        },
        findings,
        recommendations
      );
    }

    if (!coverage.some((entry) => entry.area === "infra_config")) {
      coverage.push({
        area: "infra_config",
        status: securityFindings.some((entry) => entry.area === "infra_config") ? "finding" : "ok",
        note: securityFindings.some((entry) => entry.area === "infra_config")
          ? "Se detectaron riesgos concretos de configuración o supply chain."
          : "No se confirmaron hallazgos directos de configuración en secretos, lockfiles o hygiene básica de contenedores.",
        agentId: this.agentId
      });
    }

    return {
      title: "Security Report",
      summary: "SecurityAgent evaluó exposición de secretos, higiene de dependencias y señales básicas de hardening de contenedores.",
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
