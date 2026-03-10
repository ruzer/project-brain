import { describe, expect, it } from "vitest";

import { discoverRepositoryTargets } from "../../analysis/workspace_discovery";
import { fixtureRepoPath, workspaceFixturePath } from "../helpers";

describe("workspace discovery", () => {
  it("treats a repository root as a single target", async () => {
    const scope = await discoverRepositoryTargets(fixtureRepoPath);

    expect(scope.mode).toBe("single");
    expect(scope.repositories).toHaveLength(1);
    expect(scope.repositories[0]?.repoName).toBe("sample-repo");
  });

  it("detects sibling repositories inside a workspace root", async () => {
    const scope = await discoverRepositoryTargets(workspaceFixturePath);

    expect(scope.mode).toBe("workspace");
    expect(scope.repositories.map((repository) => repository.repoName)).toEqual([
      "CashCalculator",
      "ERP",
      "OffRoadHub",
      "project-brain"
    ]);
  });
});
