import { findOpenApiFiles } from "../../tools/openapi_tools";
import { uniqueSorted } from "../../shared/fs-utils";
import type { ApiScanResult, DependencyManifest } from "../../shared/types";

function flattenDependencies(manifests: DependencyManifest[]): string[] {
  return manifests.flatMap((manifest) => manifest.dependencies.map((dependency) => dependency.toLowerCase()));
}

export function scanApis(
  files: string[],
  dependencies: DependencyManifest[],
  frameworks: string[]
): ApiScanResult {
  const apis = new Set<string>();
  const apiFiles = new Set<string>();
  const flatDependencies = flattenDependencies(dependencies);
  const openApiFiles = findOpenApiFiles(files);
  const graphQlFiles = files.filter((file) => /\.(graphql|gql)$/i.test(file) || /graphql/i.test(file));

  for (const file of openApiFiles) {
    apiFiles.add(file);
    apis.add("OpenAPI");
    if (/swagger/i.test(file)) {
      apis.add("Swagger");
    }
  }

  for (const file of graphQlFiles) {
    apiFiles.add(file);
    apis.add("GraphQL");
  }

  if (flatDependencies.some((dependency) => dependency.includes("swagger"))) {
    apis.add("Swagger");
  }

  if (flatDependencies.some((dependency) => dependency.includes("openapi"))) {
    apis.add("OpenAPI");
  }

  if (flatDependencies.some((dependency) => dependency.includes("graphql") || dependency.includes("apollo"))) {
    apis.add("GraphQL");
  }

  if (
    frameworks.some((framework) =>
      ["NestJS", "Express", "Django", "Flask", "FastAPI", "Spring", "Rails"].includes(framework)
    ) ||
    files.some((file) => /(^|\/)(routes|controllers|api)\//i.test(file))
  ) {
    apis.add("REST");
  }

  return {
    apis: uniqueSorted([...apis]),
    apiFiles: uniqueSorted([...apiFiles])
  };
}
