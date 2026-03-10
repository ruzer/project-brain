import { countDockerStages, detectInfrastructure } from "../../tools/infra_tools";
import type { InfraScanResult } from "../../shared/types";

export async function scanInfrastructure(rootPath: string, files: string[]): Promise<InfraScanResult> {
  const detection = detectInfrastructure(files);

  return {
    infrastructure: detection.technologies,
    infraFiles: detection.files,
    dockerStageCount: await countDockerStages(rootPath, detection.files)
  };
}
