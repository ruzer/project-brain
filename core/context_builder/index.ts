import { listContextAnnotations, writeAnnotationsArtifact } from "../../memory/annotations";
import { summarizeOpenApiFiles } from "../../tools/openapi_tools";
import { initializeProjectMemory, writeDiscoveryArtifacts } from "../../memory/context_store";
import { StructuredLogger } from "../../shared/logger";
import type { DiscoveryResult, ProjectContext } from "../../shared/types";

export class ContextBuilder {
  private readonly logger = new StructuredLogger("context-builder");

  async build(discovery: DiscoveryResult, outputPath: string): Promise<ProjectContext> {
    this.logger.info("Initializing project memory", {
      component: "memory",
      action: "memory_init_start",
      repoName: discovery.repoName,
      outputPath
    });

    const { memoryDir, reportsDir, docsDir, runtimeMemoryDir, learningDir, taskBoardDir, proposalDir, patchProposalDir } =
      await initializeProjectMemory(outputPath, discovery);
    const openApiSummaries = await summarizeOpenApiFiles(
      discovery.targetPath,
      discovery.apiFiles.filter((file) => /openapi|swagger/i.test(file))
    );

    await writeDiscoveryArtifacts(memoryDir, discovery, openApiSummaries);
    await writeAnnotationsArtifact(outputPath, await listContextAnnotations(outputPath));

    this.logger.info("Project memory initialized", {
      component: "memory",
      action: "memory_init_complete",
      repoName: discovery.repoName,
      memoryDir,
      reportsDir
    });

    return {
      repoName: discovery.repoName,
      targetPath: discovery.targetPath,
      outputPath,
      scannedAt: discovery.scannedAt,
      discovery,
      memoryDir,
      reportsDir,
      docsDir,
      runtimeMemoryDir,
      learningDir,
      taskBoardDir,
      proposalDir,
      patchProposalDir
    };
  }
}
