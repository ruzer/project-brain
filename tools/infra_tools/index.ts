import path from "node:path";

import { readTextSafe, uniqueSorted } from "../../shared/fs-utils";

export function detectInfrastructure(files: string[]): { technologies: string[]; files: string[] } {
  const technologies = new Set<string>();
  const infraFiles: string[] = [];

  for (const file of files) {
    const base = path.posix.basename(file);
    const lower = file.toLowerCase();

    if (base === "Dockerfile" || lower.endsWith("/dockerfile")) {
      technologies.add("Dockerfile");
      infraFiles.push(file);
    }

    if (base === "docker-compose.yml" || base === "docker-compose.yaml") {
      technologies.add("docker-compose");
      infraFiles.push(file);
    }

    if (lower.endsWith(".tf") || lower.includes("terraform/")) {
      technologies.add("Terraform");
      infraFiles.push(file);
    }

    if (base === "Chart.yaml" || lower.includes("/charts/")) {
      technologies.add("Helm");
      infraFiles.push(file);
    }

    if (
      lower.includes("/k8s/") ||
      lower.includes("/kubernetes/") ||
      base === "deployment.yaml" ||
      base === "service.yaml" ||
      base === "ingress.yaml"
    ) {
      technologies.add("Kubernetes");
      infraFiles.push(file);
    }
  }

  return {
    technologies: uniqueSorted([...technologies]),
    files: uniqueSorted(infraFiles)
  };
}

export async function countDockerStages(rootPath: string, files: string[]): Promise<number> {
  const dockerfile = files.find((file) => path.posix.basename(file) === "Dockerfile");
  if (!dockerfile) {
    return 0;
  }

  const content = await readTextSafe(path.join(rootPath, dockerfile));
  return content.match(/^FROM\s+/gim)?.length ?? 0;
}
