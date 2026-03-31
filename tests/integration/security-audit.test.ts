import { access, readFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, nextPrismaFixtureRepoPath } from "../helpers";

describe("Security audit integration", () => {
  const cleanupTargets: string[] = [];
  const originalOllamaTimeout = process.env.OLLAMA_TIMEOUT_MS;

  beforeEach(() => {
    process.env.OLLAMA_TIMEOUT_MS = "1";
  });

  afterEach(async () => {
    if (originalOllamaTimeout === undefined) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = originalOllamaTimeout;
    }
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("builds a structured security audit with verified context and evidence-based findings", async () => {
    const outputDir = await createTempOutputDir("project-brain-security-audit");
    cleanupTargets.push(outputDir);
    const orchestrator = new ProjectBrainOrchestrator();

    const result = await orchestrator.securityAudit(nextPrismaFixtureRepoPath, outputDir);

    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.coverage.length).toBeGreaterThan(0);
    expect(result.verifiedContext.architectureSummary.length).toBeGreaterThan(0);

    await access(result.reportPath);
    await access(result.memoryPath);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("### 1. Resumen ejecutivo");
    expect(report).toContain("### 2. Contexto verificado de la app");
    expect(report).toContain("### 3. Hallazgos");
    expect(report).toContain("### 7. Veredicto final");
    expect(
      report.includes("Contexto de sesión autenticada hardcodeado") ||
        report.includes("Dependencias sin lockfile versionado")
    ).toBe(true);
  });
});
