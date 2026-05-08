import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { walkDirectory } from "../../shared/fs-utils";

describe("walkDirectory", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupTargets.splice(0).map((target) => rm(target, { recursive: true, force: true })));
  });

  it("keeps nested vendor source directories while ignoring root vendor dependencies", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "project-brain-fs-utils-"));
    cleanupTargets.push(rootDir);

    await mkdir(path.join(rootDir, "vendor", "library"), { recursive: true });
    await mkdir(path.join(rootDir, "app", "src", "components", "vendor"), { recursive: true });

    await writeFile(path.join(rootDir, "vendor", "library", "index.php"), "<?php echo 'dependency';", "utf8");
    await writeFile(
      path.join(rootDir, "app", "src", "components", "vendor", "VendorSidebar.tsx"),
      "export default function VendorSidebar() { return null; }",
      "utf8"
    );

    const files = await walkDirectory(rootDir);

    expect(files).toContain("app/src/components/vendor/VendorSidebar.tsx");
    expect(files).not.toContain("vendor/library/index.php");
  });

  it("ignores local agent and project-brain runtime directories", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "project-brain-fs-utils-runtime-"));
    cleanupTargets.push(rootDir);

    await mkdir(path.join(rootDir, ".claude", "worktrees", "agent"), { recursive: true });
    await mkdir(path.join(rootDir, ".project-brain", "runtime"), { recursive: true });
    await mkdir(path.join(rootDir, "src"), { recursive: true });
    await writeFile(path.join(rootDir, ".claude", "worktrees", "agent", "scratch.ts"), "export const scratch = true;", "utf8");
    await writeFile(path.join(rootDir, ".project-brain", "runtime", "state.json"), "{}", "utf8");
    await writeFile(path.join(rootDir, "src", "index.ts"), "export const source = true;", "utf8");

    const files = await walkDirectory(rootDir);

    expect(files).toContain("src/index.ts");
    expect(files).not.toContain(".claude/worktrees/agent/scratch.ts");
    expect(files).not.toContain(".project-brain/runtime/state.json");
  });
});
