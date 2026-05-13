import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { DiscoveryEngine } from "../../core/discovery_engine";
import { ContextBuilder } from "../../core/context_builder";
import { generatePatchProposals, resolvePatchTargetPath } from "../../tools/patch_proposal_tools";
import { writeFileEnsured } from "../../shared/fs-utils";
import { cleanupDir, createTempOutputDir } from "../helpers";

async function makeContext(repoDir: string, outputDir: string) {
  await writeFileEnsured(path.join(repoDir, "package.json"), JSON.stringify({ name: "patch-proposal-fixture" }, null, 2));
  await writeFileEnsured(path.join(repoDir, "src", "components", "Button.tsx"), "export function Button() { return null; }\n");
  const discovery = await new DiscoveryEngine().analyze(repoDir);
  return new ContextBuilder().build(discovery, outputDir);
}

describe("patch proposal path confinement", () => {
  it("blocks traversal paths before resolving target files", async () => {
    const repoDir = await createTempOutputDir("project-brain-patch-traversal-repo");
    const outputDir = await createTempOutputDir("project-brain-patch-traversal-output");

    try {
      const context = await makeContext(repoDir, outputDir);

      expect(() => resolvePatchTargetPath(context, "src/components/../../outside.ts")).toThrow(/Path traversal bloqueado/);

      await writeFileEnsured(
        path.join(outputDir, "UX_IMPLEMENTATION_TASKS.md"),
        `# UX Implementation Tasks

### Task
Component: Button
File: src/components/../../outside.ts
Problem: Traversal should not be read.
User impact: None
Proposed change: Attempt to read outside target.
Risk: medium
Effort: Medium
`
      );

      const proposals = await generatePatchProposals(context);
      expect(proposals).toEqual([]);
    } finally {
      await cleanupDir(repoDir);
      await cleanupDir(outputDir);
    }
  });

  it("allows valid component paths and writes review-only proposal diffs", async () => {
    const repoDir = await createTempOutputDir("project-brain-patch-valid-repo");
    const outputDir = await createTempOutputDir("project-brain-patch-valid-output");

    try {
      const context = await makeContext(repoDir, outputDir);
      const resolved = resolvePatchTargetPath(context, "src/components/Button.tsx");

      expect(resolved.absoluteTargetPath).toBe(path.join(repoDir, "src", "components", "Button.tsx"));

      await writeFileEnsured(
        path.join(outputDir, "UX_IMPLEMENTATION_TASKS.md"),
        `# UX Implementation Tasks

### Task
Component: Button
File: src/components/Button.tsx
Problem: Button labels are unclear.
User impact: Users cannot identify the action.
Proposed change: Clarify the label.
Risk: medium
Effort: Medium
`
      );

      const proposals = await generatePatchProposals(context);
      const patchFiles = await readdir(context.patchProposalDir);
      const patch = await readFile(path.join(context.patchProposalDir, patchFiles[0] ?? ""), "utf8");

      expect(proposals).toHaveLength(1);
      expect(proposals[0]?.targetFile).toBe("src/components/Button.tsx");
      expect(patch).toContain("diff --git a/src/components/Button.tsx b/src/components/Button.tsx");
    } finally {
      await cleanupDir(repoDir);
      await cleanupDir(outputDir);
    }
  });
});
