import { inspectGit } from "../../tools/git_tools";

import type { GitInfo } from "../../shared/types";

export function detectGitIntegration(targetPath: string, hasSubmodules: boolean): GitInfo {
  return inspectGit(targetPath, hasSubmodules);
}
