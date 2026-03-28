import { access, readFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectBrainOrchestrator } from "../../core/orchestrator/main";
import { cleanupDir, createTempOutputDir, fixtureRepoPath } from "../helpers";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}

function readmeResponse(markdown: string): Response {
  return jsonResponse({
    encoding: "base64",
    content: Buffer.from(markdown, "utf8").toString("base64")
  });
}

describe("Ecosystem radar integration", () => {
  const cleanupTargets: string[] = [];

  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(cleanupTargets.splice(0).map((target) => cleanupDir(target)));
  });

  it("discovers ecosystem candidates and feeds them into the local context registry", async () => {
    const outputDir = await createTempOutputDir("project-brain-ecosystem-radar");
    cleanupTargets.push(outputDir);

    const fakeRepos = new Map([
      [
        "langchain-ai/langmem",
        {
          name: "langmem",
          full_name: "langchain-ai/langmem",
          html_url: "https://github.com/langchain-ai/langmem",
          description: "Memory toolkit for agents.",
          stargazers_count: 1300,
          forks_count: 120,
          language: "Python",
          topics: ["memory", "agents", "langchain"],
          pushed_at: "2026-03-10T00:00:00Z",
          owner: { login: "langchain-ai" },
          license: { spdx_id: "MIT" }
        }
      ],
      [
        "example/agent-memory-lab",
        {
          name: "agent-memory-lab",
          full_name: "example/agent-memory-lab",
          html_url: "https://github.com/example/agent-memory-lab",
          description: "Agent memory experiments for developer tooling.",
          stargazers_count: 890,
          forks_count: 44,
          language: "TypeScript",
          topics: ["memory", "agents", "tooling"],
          pushed_at: "2026-03-12T00:00:00Z",
          owner: { login: "example" },
          license: { spdx_id: "Apache-2.0" }
        }
      ]
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

        if (url.pathname === "/search/repositories") {
          return jsonResponse({
            items: [fakeRepos.get("example/agent-memory-lab")]
          });
        }

        const segments = url.pathname.split("/").filter(Boolean);
        if (segments[0] === "repos" && segments[1] && segments[2]) {
          const fullName = `${segments[1]}/${segments[2]}`;
          const repo =
            fakeRepos.get(fullName) ??
            {
              name: segments[2],
              full_name: fullName,
              html_url: `https://github.com/${fullName}`,
              description: `${fullName} benchmark repository.`,
              stargazers_count: 500,
              forks_count: 50,
              language: "TypeScript",
              topics: ["agents", "context"],
              pushed_at: "2026-03-01T00:00:00Z",
              owner: { login: segments[1] },
              license: { spdx_id: "MIT" }
            };

          if (segments[3] === "readme") {
            return readmeResponse(`# ${repo.name}\n\n${repo.description} README with agent memory and context details.\n`);
          }

          return jsonResponse(repo);
        }

        return new Response("not found", { status: 404 });
      })
    );

    const orchestrator = new ProjectBrainOrchestrator();
    const result = await orchestrator.ecosystemRadar(fixtureRepoPath, outputDir, {
      limit: 1,
      bucketId: "memory"
    });

    expect(result.candidates.length).toBeGreaterThan(1);
    expect(result.candidates.some((candidate) => candidate.entry.id === "langmem-agent-memory")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.repoFullName === "example/agent-memory-lab")).toBe(true);
    expect(result.candidates.some((candidate) => candidate.entry.id === "ast-grep-structural-search")).toBe(false);

    await access(result.reportPath);
    await access(result.cachePath);

    const report = await readFile(result.reportPath, "utf8");
    expect(report).toContain("Ecosystem Radar");
    expect(report).toContain("## Curated Seeds");
    expect(report).toContain("## Discovered Candidates");
    expect(report).toContain("langmem");
    expect(report).toContain("example/agent-memory-lab");
    expect(report).not.toContain("ast-grep/ast-grep");

    const contextSearch = await orchestrator.contextSearch(fixtureRepoPath, outputDir, "langmem memory", "maintainer");
    expect(contextSearch.hits.some((hit) => hit.entry.id === "langmem-agent-memory")).toBe(true);

    const contextGet = await orchestrator.contextGet(fixtureRepoPath, outputDir, "langmem-agent-memory");
    const artifact = await readFile(contextGet.artifactPath, "utf8");
    expect(artifact).toContain("LangMem Agent Memory");

    const sources = await orchestrator.contextSources(fixtureRepoPath, outputDir);
    expect(sources.sources.some((source) => source.source === "github-radar curated")).toBe(true);
  });
});
