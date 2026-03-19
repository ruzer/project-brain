export interface OllamaListResponse {
  models?: Array<{
    name?: string;
  }>;
}

export type OllamaModelResidency = "local" | "remote";

export interface OllamaModelDescriptor {
  name: string;
  residency: OllamaModelResidency;
  offlineCapable: boolean;
}

export interface OllamaGenerateResponse {
  response?: string;
}

interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream: false;
  think?: boolean;
}

export interface LocalModelAskOptions {
  timeoutMs?: number;
}

export interface LocalModelAdapter {
  listModels(): Promise<string[]>;
  listModelDescriptors?(): Promise<OllamaModelDescriptor[]>;
  ask(prompt: string, model: string, options?: LocalModelAskOptions): Promise<string>;
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

function classifyModelResidency(model: string): OllamaModelResidency {
  const normalized = model.trim().toLowerCase();
  return normalized.endsWith(":cloud") ? "remote" : "local";
}

export class OllamaAdapter implements LocalModelAdapter {
  constructor(
    private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    private readonly timeoutMs = DEFAULT_OLLAMA_TIMEOUT_MS
  ) {}

  private resolveTimeoutMs(override?: number): number {
    return parseTimeoutMs(override) ?? parseTimeoutMs(process.env.OLLAMA_TIMEOUT_MS) ?? parseTimeoutMs(this.timeoutMs) ?? DEFAULT_OLLAMA_TIMEOUT_MS;
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
      return [...new Set((payload.models ?? []).map((model) => model.name).filter(Boolean) as string[])].sort((left, right) => left.localeCompare(right));
    } catch {
      return [];
    }
  }

  async listModelDescriptors(): Promise<OllamaModelDescriptor[]> {
    const models = await this.listModels();
    return models.map((name) => {
      const residency = classifyModelResidency(name);
      return {
        name,
        residency,
        offlineCapable: residency === "local"
      };
    });
  }

  async ask(prompt: string, model: string, options: LocalModelAskOptions = {}): Promise<string> {
    const request: OllamaGenerateRequest = {
      model: withDefaultTag(model),
      prompt,
      stream: false,
      think: false
    };

    const withThinkDisabled = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.resolveTimeoutMs(options.timeoutMs))
    });

    let response = withThinkDisabled;
    if (!response.ok && response.status >= 400 && response.status < 500) {
      const retryRequest: OllamaGenerateRequest = {
        model: request.model,
        prompt: request.prompt,
        stream: false
      };

      response = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(retryRequest),
        signal: AbortSignal.timeout(this.resolveTimeoutMs(options.timeoutMs))
      });
    }

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
