import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OLLAMA_TIMEOUT_MS, OllamaAdapter } from "../../integrations/ollama_adapter";

const originalTimeout = process.env.OLLAMA_TIMEOUT_MS;

describe("OllamaAdapter", () => {
  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.OLLAMA_TIMEOUT_MS;
    } else {
      process.env.OLLAMA_TIMEOUT_MS = originalTimeout;
    }

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the configured timeout for Ollama list and generate requests", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "qwen2.5-coder:7b" }] })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: "{\"issues\":[]}" })
      });

    vi.stubGlobal("fetch", fetchMock);
    delete process.env.OLLAMA_TIMEOUT_MS;

    const adapter = new OllamaAdapter("http://127.0.0.1:11434", 240_000);
    await adapter.listModels();
    await adapter.ask("Return JSON only.", "qwen2.5-coder:7b");

    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 240_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 240_000);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        body: JSON.stringify({
          model: "qwen2.5-coder:7b",
          prompt: "Return JSON only.",
          stream: false,
          think: false
        })
      })
    );
  });

  it("prefers the environment timeout override over the configured timeout", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => new AbortController().signal);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "ok" })
    });

    vi.stubGlobal("fetch", fetchMock);
    process.env.OLLAMA_TIMEOUT_MS = "123456";

    const adapter = new OllamaAdapter("http://127.0.0.1:11434", DEFAULT_OLLAMA_TIMEOUT_MS);
    await adapter.ask("Return JSON only.", "qwen2.5-coder:7b");

    expect(timeoutSpy).toHaveBeenCalledWith(123_456);
  });

  it("retries without the think flag when Ollama rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ response: "ok" })
      });

    vi.stubGlobal("fetch", fetchMock);

    const adapter = new OllamaAdapter("http://127.0.0.1:11434", DEFAULT_OLLAMA_TIMEOUT_MS);
    await expect(adapter.ask("Return JSON only.", "qwen2.5-coder:7b")).resolves.toBe("ok");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        body: JSON.stringify({
          model: "qwen2.5-coder:7b",
          prompt: "Return JSON only.",
          stream: false,
          think: false
        })
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:11434/api/generate",
      expect.objectContaining({
        body: JSON.stringify({
          model: "qwen2.5-coder:7b",
          prompt: "Return JSON only.",
          stream: false
        })
      })
    );
  });
});
