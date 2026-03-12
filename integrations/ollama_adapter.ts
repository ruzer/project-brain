export interface OllamaListResponse {
  models?: Array<{
    name?: string;
  }>;
}

export interface OllamaGenerateResponse {
  response?: string;
}

export interface LocalModelAdapter {
  listModels(): Promise<string[]>;
  ask(prompt: string, model: string): Promise<string>;
}

export const DEFAULT_OLLAMA_TIMEOUT_MS = 180_000;

function withDefaultTag(model: string): string {
  return model.includes(":") ? model : `${model}:latest`;
}

function parseTimeoutMs(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return numeric;
}

export class OllamaAdapter implements LocalModelAdapter {
  constructor(
    private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    private readonly timeoutMs = DEFAULT_OLLAMA_TIMEOUT_MS
  ) {}

  private resolveTimeoutMs(): number {
    return parseTimeoutMs(process.env.OLLAMA_TIMEOUT_MS) ?? parseTimeoutMs(this.timeoutMs) ?? DEFAULT_OLLAMA_TIMEOUT_MS;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(this.resolveTimeoutMs())
      });

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json()) as OllamaListResponse;
      return [...new Set((payload.models ?? []).map((model) => model.name).filter(Boolean) as string[])].sort((left, right) =>
        left.localeCompare(right)
      );
    } catch {
      return [];
    }
  }

  async ask(prompt: string, model: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: withDefaultTag(model),
        prompt,
        stream: false
      }),
      signal: AbortSignal.timeout(this.resolveTimeoutMs())
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as OllamaGenerateResponse;
    if (!payload.response) {
      throw new Error("Ollama response did not include generated content.");
    }

    return payload.response.trim();
  }
}
