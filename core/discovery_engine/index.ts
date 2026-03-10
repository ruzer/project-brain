import { scanApis } from "../../analysis/api_scanner";
import { scanDependencies } from "../../analysis/dependency_scanner";
import { scanInfrastructure } from "../../analysis/infra_scanner";
import { scanRepositoryStructure } from "../../analysis/repo_scanner";
import { detectCi } from "../../integrations/ci";
import { detectGitIntegration } from "../../integrations/git";
import { detectLogging } from "../../integrations/logs";
import { detectMetrics } from "../../integrations/metrics";
import { StructuredLogger } from "../../shared/logger";
import { uniqueSorted } from "../../shared/fs-utils";
import type { DiscoveryResult } from "../../shared/types";

function buildRecommendations(discovery: Omit<DiscoveryResult, "recommendations">): string[] {
  const recommendations: string[] = [];

  if (discovery.ci.providers.length === 0) {
    recommendations.push("Add a CI workflow to run validation on every change.");
  }

  if (discovery.testing.length === 0) {
    recommendations.push("Establish an automated testing baseline for the primary runtime.");
  }

  if (discovery.apis.includes("REST") && !discovery.apis.includes("OpenAPI")) {
    recommendations.push("Publish an OpenAPI contract for the main API surface.");
  }

  if (!discovery.logging.structured) {
    recommendations.push("Adopt structured logging for traceable operational diagnostics.");
  }

  if (discovery.metrics.tools.length === 0) {
    recommendations.push("Add metrics or tracing instrumentation for critical execution paths.");
  }

  return uniqueSorted(recommendations);
}

export class DiscoveryEngine {
  private readonly logger = new StructuredLogger("discovery-engine");

  async analyze(targetPath: string, options?: { excludePaths?: string[] }): Promise<DiscoveryResult> {
    this.logger.info("Scanning repository", {
      component: "discovery",
      action: "scan_start",
      targetPath,
      excludePaths: options?.excludePaths ?? []
    });

    const repoScan = await scanRepositoryStructure(targetPath, options?.excludePaths ?? []);
    const dependencyScan = await scanDependencies(targetPath, repoScan.files);
    const apiScan = scanApis(repoScan.files, dependencyScan.dependencies, dependencyScan.frameworks);
    const infraScan = await scanInfrastructure(targetPath, repoScan.files);
    const git = detectGitIntegration(targetPath, repoScan.structure.submodules.length > 0);
    const ci = detectCi(repoScan.files);
    const logging = detectLogging(repoScan.files, dependencyScan.dependencies);
    const metrics = detectMetrics(repoScan.files, dependencyScan.dependencies);

    const discoveryBase: Omit<DiscoveryResult, "recommendations"> = {
      repoName: repoScan.repoName,
      targetPath,
      scannedAt: repoScan.scannedAt,
      files: repoScan.files,
      structure: repoScan.structure,
      languages: repoScan.languages,
      frameworks: dependencyScan.frameworks,
      apis: apiScan.apis,
      infrastructure: infraScan.infrastructure,
      testing: dependencyScan.testing,
      dependencies: dependencyScan.dependencies,
      manifests: dependencyScan.manifests,
      apiFiles: apiScan.apiFiles,
      infraFiles: infraScan.infraFiles,
      dockerStageCount: infraScan.dockerStageCount,
      git,
      ci,
      logging,
      metrics
    };

    const discovery = {
      ...discoveryBase,
      recommendations: buildRecommendations(discoveryBase)
    };

    this.logger.info("Repository scan completed", {
      component: "discovery",
      action: "scan_complete",
      repoName: discovery.repoName,
      files: discovery.structure.fileCount,
      frameworks: discovery.frameworks
    });

    return discovery;
  }
}
