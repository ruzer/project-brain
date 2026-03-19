import { describe, expect, it } from "vitest";

import { AIRouter } from "../../core/ai_router/router";
import type { LocalModelAdapter, OllamaModelDescriptor } from "../../integrations/ollama_adapter";

class StubLocalAdapter implements LocalModelAdapter {
  constructor(
    private readonly models: string[] | OllamaModelDescriptor[],
    private readonly response = "stubbed-local-response"
  ) {}

  async listModels(): Promise<string[]> {
    return Array.isArray(this.models) && typeof this.models[0] === "string"
      ? (this.models as string[])
      : (this.models as OllamaModelDescriptor[]).map((model) => model.name);
  }

  async listModelDescriptors(): Promise<OllamaModelDescriptor[]> {
    if (Array.isArray(this.models) && typeof this.models[0] !== "string") {
      return this.models as OllamaModelDescriptor[];
    }

    return (this.models as string[]).map((model) => ({
      name: model,
      residency: model.endsWith(":cloud") ? "remote" : "local",
      offlineCapable: !model.endsWith(":cloud")
    }));
  }

  async ask(_prompt: string, model: string): Promise<string> {
    return `${this.response}:${model}`;
  }
}

describe("AIRouter", () => {
  it("routes repository scanning, code smell detection, and UX audit prompts to local models", async () => {
    const router = new AIRouter({
      config: {
        localModel: "qwen2.5-coder",
        cloudModel: "gpt-4o",
        fallbackModel: "deepseek-coder",
        reasoningModel: "llama3.1:8b",
        profiles: {
          worker: "qwen2.5-coder",
          reviewer: "deepseek-coder",
          reasoning: "llama3.1:8b",
          planner: "kimi-k2.5:cloud",
          synthesizer: "llama3.1:8b"
        }
      },
      localAdapter: new StubLocalAdapter([
        "deepseek-coder:6.7b",
        "llama3.1:8b",
        "qwen2.5-coder:7b"
      ])
    });

    await expect(router.selectModel({ task: "repository-scanning", prompt: "Run repository scanning on this codebase" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      profile: "worker"
    });
    await expect(router.selectModel({ task: "ux-improvement", prompt: "Generate UX improvement tasks for the frontend shell" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:6.7b",
      profile: "reviewer"
    });
    await expect(router.selectModel({ task: "code-smell-detection", prompt: "Perform code smell detection on src modules" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:6.7b",
      profile: "reviewer"
    });
    await expect(router.selectModel({ task: "ux-audit", prompt: "Prepare a UX audit for the frontend shell" })).resolves.toMatchObject({
      selectedRoute: "local",
      provider: "ollama",
      model: "deepseek-coder:6.7b",
      profile: "reviewer"
    });
  });

  it("uses the remote Ollama planner model for strategic tasks when enabled", async () => {
    const router = new AIRouter({
      config: {
        localModel: "qwen2.5-coder",
        cloudModel: "gpt-4o",
        fallbackModel: "deepseek-coder",
        reasoningModel: "llama3.1:8b",
        allowRemoteOllama: true,
        profiles: {
          worker: "qwen2.5-coder",
          reviewer: "deepseek-coder",
          reasoning: "llama3.1:8b",
          planner: "kimi-k2.5:cloud",
          synthesizer: "llama3.1:8b"
        }
      },
      localAdapter: new StubLocalAdapter([
        { name: "kimi-k2.5:cloud", residency: "remote", offlineCapable: false },
        { name: "qwen2.5-coder:7b", residency: "local", offlineCapable: true }
      ]),
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
    expect(architectureSelection.selectedRoute).toBe("cloud");
    expect(architectureSelection.model).toBe("kimi-k2.5:cloud");
    expect(architectureSelection.provider).toBe("ollama");
    expect(architectureSelection.profile).toBe("planner");
    expect(refactorSelection.preferredRoute).toBe("cloud");
    expect(refactorSelection.selectedRoute).toBe("cloud");
    expect(refactorSelection.model).toBe("kimi-k2.5:cloud");
    expect(refactorSelection.profile).toBe("planner");
  });

  it("can answer fully offline when only local models exist", async () => {
    const router = new AIRouter({
      config: {
        localModel: "deepseek-coder",
        cloudModel: "gpt-4o",
        fallbackModel: "mistral",
        reasoningModel: "llama3.1:8b",
        allowRemoteOllama: true,
        profiles: {
          worker: "deepseek-coder",
          reviewer: "deepseek-coder",
          reasoning: "llama3.1:8b",
          planner: "kimi-k2.5:cloud",
          synthesizer: "llama3.1:8b"
        }
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

  it("keeps inventory aware of local versus remote Ollama models", async () => {
    const router = new AIRouter({
      localAdapter: new StubLocalAdapter([
        { name: "kimi-k2.5:cloud", residency: "remote", offlineCapable: false },
        { name: "llama3.1:8b", residency: "local", offlineCapable: true }
      ])
    });

    const inventory = await router.listModels();

    expect(inventory.availableModels).toEqual([
      { name: "kimi-k2.5:cloud", residency: "remote", offlineCapable: false },
      { name: "llama3.1:8b", residency: "local", offlineCapable: true }
    ]);
    expect(inventory.offlineReady).toBe(true);
    expect(inventory.remoteOllamaAllowed).toBe(true);
  });
});
