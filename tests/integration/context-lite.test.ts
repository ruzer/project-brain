import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath, nextPrismaFixtureRepoPath } from "../helpers";

describe("Context-lite integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("writes a lightweight AI_CONTEXT pack for smaller apps", async () => {
    const outputDir = await createTempOutputDir("project-brain-context-lite");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.contextLite(fixtureRepoPath, outputDir);

    const expectedFiles = [
      "system_overview.md",
      "domain_inventory.md",
      "modules_map.md",
      "frontend_architecture.md",
      "backend_flows_and_contracts.md",
      "ui_rules.md",
      "MASTER_CONTEXT_PROMPT.md",
      "DECISIONS.md",
      "LEARNINGS.md",
      "TASKS.md"
    ];

    expect(result.artifactPaths).toHaveLength(expectedFiles.length);
    expect(result.reportPath).toBe(path.join(outputDir, "reports", "context_lite.md"));
    expect(result.summary.length).toBeGreaterThan(5);
    expect(result.openQuestions.length).toBeGreaterThan(0);

    for (const fileName of expectedFiles) {
      const content = await readFile(path.join(outputDir, "AI_CONTEXT", fileName), "utf8");
      expect(content.trim().length).toBeGreaterThan(20);
    }

    const systemOverview = await readFile(path.join(outputDir, "AI_CONTEXT", "system_overview.md"), "utf8");
    expect(systemOverview).toContain("sample-repo");
    expect(systemOverview).toContain("Express");

    const backendFlows = await readFile(path.join(outputDir, "AI_CONTEXT", "backend_flows_and_contracts.md"), "utf8");
    expect(backendFlows).toContain("openapi.yaml");
    expect(backendFlows).toContain("schema.graphql");

    const tasks = await readFile(path.join(outputDir, "AI_CONTEXT", "TASKS.md"), "utf8");
    expect(tasks).toContain("context-lite:generated:start");
    expect(tasks).toContain("Confirmar la fuente de verdad de datos");

    const masterPrompt = await readFile(path.join(outputDir, "AI_CONTEXT", "MASTER_CONTEXT_PROMPT.md"), "utf8");
    expect(masterPrompt).toContain("Actua como analista tecnico del repositorio actual.");
    expect(masterPrompt).toContain("AI_CONTEXT/");
    expect(masterPrompt).toContain(fixtureRepoPath);
    expect(masterPrompt).toContain("Contexto confirmado en esta corrida");
    expect(masterPrompt).toContain("Forma detectada: Backend/API service");
    expect(masterPrompt).toContain("Fuentes que debes priorizar");
    expect(masterPrompt).toContain("Dominios detectados en esta corrida");
    expect(masterPrompt).toContain("Superficies activas ya confirmadas");
    expect(masterPrompt).toContain("Huecos o ambigüedades que siguen abiertas");
  });

  it("prioritizes prisma and full-stack next signals when present", async () => {
    const outputDir = await createTempOutputDir("project-brain-context-lite-next-prisma");
    cleanupTargets.push(outputDir);

    const orchestrator = new ProjectBrainOrchestrator();
    await orchestrator.contextLite(nextPrismaFixtureRepoPath, outputDir);

    const systemOverview = await readFile(path.join(outputDir, "AI_CONTEXT", "system_overview.md"), "utf8");
    expect(systemOverview).toContain("Full-stack web application");
    expect(systemOverview).toContain("Prisma schema define la fuente de verdad relacional");
    expect(systemOverview).toContain("Usuarios públicos o tráfico anónimo");
    expect(systemOverview).toContain("Fuentes canónicas declaradas por la documentación");
    expect(systemOverview).toContain("app/src/app/api/*");
    expect(systemOverview).toContain("app/prisma/schema.prisma");
    expect(systemOverview).toContain("Documentos operativos de referencia");
    expect(systemOverview).toContain("app/docs/README.md");
    expect(systemOverview).toContain("Documentación estructurada detectada");
    expect(systemOverview).not.toContain("Admin override");
    expect(systemOverview).not.toContain("Actor documentado: GET");
    expect(systemOverview).not.toContain("AI_CONTEXT/ARCHITECTURE.md");
    expect(systemOverview).toContain("contiene marcadores de conflicto");

    const frontendArchitecture = await readFile(
      path.join(outputDir, "AI_CONTEXT", "frontend_architecture.md"),
      "utf8"
    );
    expect(frontendArchitecture).toContain("app/src/components/");
    expect(frontendArchitecture).toContain("VendorSidebar");
    expect(frontendArchitecture).toContain("Overview");

    const domainInventory = await readFile(path.join(outputDir, "AI_CONTEXT", "domain_inventory.md"), "utf8");
    expect(domainInventory).toContain("access-control");
    expect(domainInventory).toContain("app/src/lib/auth/permissions.ts");
    expect(domainInventory).toContain("vendor-dashboard");
    expect(domainInventory).toContain("notifications");
    expect(domainInventory).toContain("profiles");
    expect(domainInventory).toContain("app/src/app/api/profile/public/route.ts");
    expect(domainInventory).toContain("app/src/services/publicProfileService.ts");
    expect(domainInventory).toContain("reports");
    expect(domainInventory).toContain("app/src/app/api/reports/route.ts");
    expect(domainInventory).not.toContain("app/backups/vendor_snapshot.json");
    expect(domainInventory).not.toContain("AI_CONTEXT/vendor_notes.md");
    expect(domainInventory).not.toContain("El dominio `reports` está documentado, pero no se asociaron superficies");

    const backendFlows = await readFile(path.join(outputDir, "AI_CONTEXT", "backend_flows_and_contracts.md"), "utf8");
    expect(backendFlows).toContain("app/API.md");
    expect(backendFlows).toContain("app/BUSINESS_RULES.md");
    expect(backendFlows).toContain("contiene marcadores de conflicto");

    const uiRules = await readFile(path.join(outputDir, "AI_CONTEXT", "ui_rules.md"), "utf8");
    expect(uiRules).toContain("menús por actor");
    expect(uiRules).toContain("permission-check");

    const masterPrompt = await readFile(path.join(outputDir, "AI_CONTEXT", "MASTER_CONTEXT_PROMPT.md"), "utf8");
    expect(masterPrompt).toContain("Usa este prompt cuando necesites crear o refrescar el `AI_CONTEXT/`");
    expect(masterPrompt).toContain(nextPrismaFixtureRepoPath);
    expect(masterPrompt).toContain("Forma detectada: Full-stack web application");
    expect(masterPrompt).toContain("Fuentes canónicas declaradas por esta corrida");
    expect(masterPrompt).toContain("`app/src/app/api/*`");
    expect(masterPrompt).toContain("`app/prisma/schema.prisma`");
    expect(masterPrompt).toContain("Documentos operativos de referencia");
    expect(masterPrompt).toContain("`app/API.md`");
    expect(masterPrompt).toContain("`app/docs/README.md`");
    expect(masterPrompt).toContain("Dominios detectados en esta corrida");
    expect(masterPrompt).toContain("`profiles`");
    expect(masterPrompt).toContain("`reports`");
    expect(masterPrompt).toContain("Superficies activas ya confirmadas");
    expect(masterPrompt).toContain("Huecos o ambigüedades que siguen abiertas");
    expect(masterPrompt).toContain("contiene marcadores de conflicto");

    const decisions = await readFile(path.join(outputDir, "AI_CONTEXT", "DECISIONS.md"), "utf8");
    expect(decisions).toContain("Reduce friction during activation");
    expect(decisions).toContain("declara como canon");

    const tasks = await readFile(path.join(outputDir, "AI_CONTEXT", "TASKS.md"), "utf8");
    expect(tasks).toContain("Validar documentación marcada como pendiente o draft");
    expect(tasks).toContain("Resolver ambigüedad en fuentes de verdad");
    expect(tasks).not.toContain("Add a CI workflow to run validation on every change.");
  });

  it("extracts PHP MVC business domains from controllers, models, views, and SQL", async () => {
    const repoDir = await createTempOutputDir("project-brain-context-lite-php-mvc-repo");
    const outputDir = await createTempOutputDir("project-brain-context-lite-php-mvc-output");
    cleanupTargets.push(repoDir, outputDir);

    await mkdir(path.join(repoDir, "default", "app", "controllers"), { recursive: true });
    await mkdir(path.join(repoDir, "default", "app", "models"), { recursive: true });
    await mkdir(path.join(repoDir, "default", "app", "views", "empleado"), { recursive: true });
    await mkdir(path.join(repoDir, "default", "app", "config"), { recursive: true });
    await writeFile(
      path.join(repoDir, "README.md"),
      `![KumbiaPHP logo](https://example.test/logo.svg)

## Sistema para el control de la información del personal

Registro, administración y generación de gafetes de identificación para el personal activo.
`
    );
    await writeFile(path.join(repoDir, "default", "app", "config", "config.php"), "<?php\n");
    await writeFile(
      path.join(repoDir, "default", "app", "controllers", "empleado_controller.php"),
      "<?php\nclass EmpleadoController extends AppController { public function listar() {} public function registrar() {} }\n"
    );
    await writeFile(
      path.join(repoDir, "default", "app", "controllers", "cuenta_controller.php"),
      "<?php\nclass CuentaController extends AppController { public function listar() {} }\n"
    );
    await writeFile(
      path.join(repoDir, "default", "app", "models", "empleado.php"),
      "<?php\nclass Empleado extends ActiveRecord { public static function setEmpleado() {} }\n"
    );
    await writeFile(path.join(repoDir, "default", "app", "views", "empleado", "listar.phtml"), "<h1>Empleados</h1>\n");
    await writeFile(path.join(repoDir, "gafete.sql"), "CREATE TABLE `empleado` (`id` int);\n");

    const orchestrator = new ProjectBrainOrchestrator();
    await orchestrator.contextLite(repoDir, outputDir);

    const systemOverview = await readFile(path.join(outputDir, "AI_CONTEXT", "system_overview.md"), "utf8");
    expect(systemOverview).toContain("Sistema para el control de la información del personal");
    expect(systemOverview).toContain("KumbiaPHP");
    expect(systemOverview).toContain("Dump o esquema SQL versionado");

    const domainInventory = await readFile(path.join(outputDir, "AI_CONTEXT", "domain_inventory.md"), "utf8");
    expect(domainInventory).toContain("Dominio `empleado`");
    expect(domainInventory).toContain("default/app/controllers/empleado_controller.php");
    expect(domainInventory).toContain("default/app/models/empleado.php");
    expect(domainInventory).toContain("Dominio `cuenta`");

    const modulesMap = await readFile(path.join(outputDir, "AI_CONTEXT", "modules_map.md"), "utf8");
    expect(modulesMap).toContain("Módulo empleado");
    expect(modulesMap).toContain("Módulo MVC PHP/Kumbia");

    const backendFlows = await readFile(path.join(outputDir, "AI_CONTEXT", "backend_flows_and_contracts.md"), "utf8");
    expect(backendFlows).toContain("Kumbia action /empleado/listar");
    expect(backendFlows).toContain("gafete.sql");
  });
});
