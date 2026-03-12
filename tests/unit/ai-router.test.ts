import { describe, expect, it } from "vitest";

import { AIRouter } from "../../core/ai_router/router";
import type { LocalModelAdapter } from "../../integrations/ollama_adapter";

class StubLocalAdapter implements LocalModelAdapter {
  constructor(
    private readonly models: string[],
    private readonly response = "stubbed-local-response"
  ) {}

  async listModels(): Promise<string[]> {
    return this.models;
  }

  async ask(_prompt: string, model: string): Promise<string> {
    return `${this.response}:${model}`;
  }
}

describe("AIRouter", () => {
  it("routes repository scanning, code smell detection, and UX audit prompts to local models", async () => {
    const router = new AIRouter({
      config: {
        localModel: "deepseek-coder",
        cloudModel: "gpt-4o",
        fallbackModel: "mistral"
      },
      localAdapter: new StubLocalAdapter(["deepseek-coder:latest", "mistral:latest"])
    });

    await expect(router.selectModel({ task: "repository-scanning", prompt: "Run repository scanning on this codebase" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:latest"
    });
    await expect(router.selectModel({ task: "ux-improvement", prompt: "Generate UX improvement tasks for the frontend shell" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:latest"
    });
    await expect(router.selectModel({ task: "code-smell-detection", prompt: "Perform code smell detection on src modules" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:latest"
    });
    await expect(router.selectModel({ task: "ux-audit", prompt: "Prepare a UX audit for the frontend shell" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:latest"
    });
  });

  it("prefers cloud for architecture redesign and large refactor proposals but falls back to local offline", async () => {
    const router = new AIRouter({
      config: {
        localModel: "deepseek-coder",
        cloudModel: "gpt-4o",
        fallbackModel: "mistral"
      },
      localAdapter: new StubLocalAdapter(["mistral:latest"]),
      cloudEnabled: false
    });

    const architectureSelection = await router.selectModel({
      task: "architecture-review",
      prompt: "Draft an architecture redesign for the platform"
    });
    const refactorSelection = await router.selectModel({
      task: "large-refactor-analysis",
      prompt: "Prepare a large refactor proposal for the runtime"
    });

    expect(architectureSelection.preferredRoute).toBe("cloud");
    expect(architectureSelection.selectedRoute).toBe("local");
    expect(architectureSelection.model).toBe("mistral:latest");
    expect(refactorSelection.preferredRoute).toBe("cloud");
    expect(refactorSelection.selectedRoute).toBe("local");
    expect(refactorSelection.model).toBe("mistral:latest");
  });

  it("can answer fully offline when only local models exist", async () => {
    const router = new AIRouter({
      config: {
        localModel: "deepseek-coder",
        cloudModel: "gpt-4o",
        fallbackModel: "mistral"
      },
      localAdapter: new StubLocalAdapter(["deepseek-coder:latest"]),
      cloudEnabled: false
    });

    await expect(router.ask({ task: "repository-scanning", prompt: "Run repository scanning on this project" })).resolves.toBe(
      "stubbed-local-response:deepseek-coder:latest"
    );
    await expect(router.ask({ task: "architecture-review", prompt: "Draft an architecture redesign for this service mesh" })).resolves.toBe(
      "stubbed-local-response:deepseek-coder:latest"
    );
  });
});
