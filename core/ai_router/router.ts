import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_OLLAMA_TIMEOUT_MS,
  OllamaAdapter,
  type LocalModelAdapter
} from "../../integrations/ollama_adapter";
import { StructuredLogger } from "../../shared/logger";

export type ModelRoute = "local" | "cloud";
export type LocalProvider = "ollama";
export type CloudProvider = "openai" | "codex" | "gemini";
export type ModelProvider = LocalProvider | CloudProvider;
export type AIRouterTask =
  | "repository-scanning"
  | "code-smell-detection"
  | "ux-audit"
  | "ux-improvement"
  | "qa-analysis"
  | "architecture-review"
  | "performance-analysis"
  | "documentation-review"
  | "large-refactor-analysis"
  | "generic-analysis";

export interface ModelConfig {
  localModel: string;
  cloudModel: string;
  fallbackModel: string;
  ollamaTimeoutMs: number;
  routing: Partial<Record<AIRouterTask, ModelRoute>>;
}

export interface ModelSelection {
  preferredRoute: ModelRoute;
  selectedRoute: ModelRoute;
  provider: ModelProvider;
  model: string;
  reason: string;
  offlineCapable: boolean;
}

export interface ModelInventory {
  config: ModelConfig;
  localProvider: LocalProvider;
  localModelsAvailable: string[];
  localConfigured: string;
  fallbackConfigured: string;
  cloudConfigured: {
    provider: CloudProvider;
    model: string;
  };
  routing: Partial<Record<AIRouterTask, ModelRoute>>;
  offlineReady: boolean;
}

export interface AIRouterRequest {
  task?: AIRouterTask;
  prompt: string;
  context?: string;
}

interface AIRouterOptions {
  config?: Partial<ModelConfig>;
  localAdapter?: LocalModelAdapter;
  cloudEnabled?: boolean;
}

const DEFAULT_ROUTING: Partial<Record<AIRouterTask, ModelRoute>> = {
  "repository-scanning": "local",
  "code-smell-detection": "local",
  "ux-audit": "local",
  "ux-improvement": "local",
  "qa-analysis": "local",
  "performance-analysis": "local",
  "documentation-review": "local",
  "architecture-review": "cloud",
  "large-refactor-analysis": "cloud",
  "generic-analysis": "local"
};

function parseTimeoutMs(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return numeric;
}

const DEFAULT_OLLAMA_TIMEOUT = parseTimeoutMs(process.env.OLLAMA_TIMEOUT_MS) ?? DEFAULT_OLLAMA_TIMEOUT_MS;

const DEFAULT_CONFIG: ModelConfig = {
  localModel: "qwen2.5-coder:7b",
  cloudModel: "gpt-4.1",
  fallbackModel: "deepseek-coder:6.7b",
  ollamaTimeoutMs: DEFAULT_OLLAMA_TIMEOUT,
  routing: DEFAULT_ROUTING
};

const PROMPT_LOCAL_HINTS = [
  /repository\s+scann/i,
  /scan\s+the\s+repo/i,
  /repo(sitory)?\s+discover/i,
  /code\s+smell/i,
  /smell\s+detection/i,
  /ux\s+audit/i,
  /ux\s+improvement/i,
  /ui\s+audit/i,
  /usability\s+audit/i,
  /performance\s+analysis/i,
  /documentation\s+review/i,
  /qa\s+analysis/i
];

const PROMPT_CLOUD_HINTS = [
  /architecture\s+redesign/i,
  /redesign\s+the\s+architecture/i,
  /architecture\s+review/i,
  /re-?architect/i,
  /large\s+refactor\s+proposal/i,
  /large\s+refactor/i,
  /major\s+refactor/i,
  /system\s+redesign/i
];

function resolveProjectBrainRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const candidate = path.join(current, "package.json");
    if (existsSync(candidate)) {
      try {
        const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (parsed.name === "project-brain") {
          return current;
        }
      } catch {
        // Keep walking until the package root is found.
      }
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return process.cwd();
    }
    current = parent;
  }
}

function loadConfigFromDisk(): ModelConfig {
  const root = resolveProjectBrainRoot(__dirname);
  const configPath = path.join(root, "config", "models.json");

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as Partial<ModelConfig> & {
      local?: string;
      cloud?: string;
      fallback?: string;
      local_model?: string;
      cloud_model?: string;
      fallback_model?: string;
      ollama_timeout_ms?: number;
      routing?: Partial<Record<AIRouterTask, ModelRoute>>;
    };

    return {
      localModel: parsed.localModel ?? parsed.local_model ?? parsed.local ?? DEFAULT_CONFIG.localModel,
      cloudModel: parsed.cloudModel ?? parsed.cloud_model ?? parsed.cloud ?? DEFAULT_CONFIG.cloudModel,
      fallbackModel: parsed.fallbackModel ?? parsed.fallback_model ?? parsed.fallback ?? DEFAULT_CONFIG.fallbackModel,
      ollamaTimeoutMs: parseTimeoutMs(parsed.ollamaTimeoutMs ?? parsed.ollama_timeout_ms) ?? DEFAULT_CONFIG.ollamaTimeoutMs,
      routing: {
        ...DEFAULT_ROUTING,
        ...(parsed.routing ?? {})
      }
    };
  } catch {
    return { ...DEFAULT_CONFIG, routing: { ...DEFAULT_ROUTING } };
  }
}

function inferCloudProvider(model: string): CloudProvider {
  const normalized = model.toLowerCase();
  if (normalized.includes("gemini")) {
    return "gemini";
  }
  if (normalized.includes("codex")) {
    return "codex";
  }
  return "openai";
}

function withDefaultTag(model: string): string {
  return model.includes(":") ? model : `${model}:latest`;
}

function resolveLocalModel(preferred: string, available: string[]): string | undefined {
  const exact = available.find((model) => model === preferred || model === withDefaultTag(preferred));
  if (exact) {
    return exact;
  }

  const prefix = available.find((model) => model === preferred || model.startsWith(`${preferred}:`));
  if (prefix) {
    return prefix;
  }

  return undefined;
}

function normalizeRequest(request: string | AIRouterRequest): AIRouterRequest {
  if (typeof request === "string") {
    return {
      prompt: request,
      task: "generic-analysis"
    };
  }

  return {
    task: request.task ?? "generic-analysis",
    prompt: request.prompt,
    context: request.context
  };
}

function inferPreferredRoute(request: AIRouterRequest, config: ModelConfig): ModelRoute {
  if (request.task && config.routing[request.task]) {
    return config.routing[request.task] as ModelRoute;
  }

  if (PROMPT_CLOUD_HINTS.some((rule) => rule.test(request.prompt))) {
    return "cloud";
  }

  if (PROMPT_LOCAL_HINTS.some((rule) => rule.test(request.prompt))) {
    return "local";
  }

  return "local";
}

export class AIRouter {
  private readonly logger = new StructuredLogger("ai-router");
  private readonly config: ModelConfig;
  private readonly localAdapter: LocalModelAdapter;
  private readonly cloudEnabled: boolean;

  constructor(options: AIRouterOptions = {}) {
    this.config = {
      ...loadConfigFromDisk(),
      ...options.config,
      routing: {
        ...loadConfigFromDisk().routing,
        ...(options.config?.routing ?? {})
      }
    };
    this.localAdapter = options.localAdapter ?? new OllamaAdapter(undefined, this.config.ollamaTimeoutMs);
    this.cloudEnabled = options.cloudEnabled ?? false;
  }

  routeForPrompt(request: string | AIRouterRequest): ModelRoute {
    return inferPreferredRoute(normalizeRequest(request), this.config);
  }

  async listModels(): Promise<ModelInventory> {
    const localModelsAvailable = await this.localAdapter.listModels();
    const localConfigured =
      resolveLocalModel(this.config.localModel, localModelsAvailable) ??
      localModelsAvailable[0] ??
      this.config.localModel;
    const fallbackConfigured =
      resolveLocalModel(this.config.fallbackModel, localModelsAvailable) ??
      localModelsAvailable[0] ??
      this.config.fallbackModel;

    return {
      config: {
        ...this.config,
        routing: { ...this.config.routing }
      },
      localProvider: "ollama",
      localModelsAvailable,
      localConfigured,
      fallbackConfigured,
      cloudConfigured: {
        provider: inferCloudProvider(this.config.cloudModel),
        model: this.config.cloudModel
      },
      routing: { ...this.config.routing },
      offlineReady: localModelsAvailable.length > 0
    };
  }

  async selectModel(input: string | AIRouterRequest): Promise<ModelSelection> {
    const request = normalizeRequest(input);
    const preferredRoute = inferPreferredRoute(request, this.config);
    const inventory = await this.listModels();
    const configuredLocal = resolveLocalModel(this.config.localModel, inventory.localModelsAvailable);
    const fallbackLocal = resolveLocalModel(this.config.fallbackModel, inventory.localModelsAvailable);
    const anyLocalModel = inventory.localModelsAvailable[0];

    if (preferredRoute === "local") {
      const localModel = configuredLocal ?? fallbackLocal ?? anyLocalModel ?? this.config.localModel;
      return {
        preferredRoute,
        selectedRoute: "local",
        provider: "ollama",
        model: localModel,
        reason: configuredLocal
          ? `Task ${request.task ?? "generic-analysis"} is local-preferred and will run on Ollama.`
          : fallbackLocal
            ? `Task ${request.task ?? "generic-analysis"} is local-preferred; using the configured local fallback model via Ollama.`
            : anyLocalModel
              ? `Task ${request.task ?? "generic-analysis"} is local-preferred; using the first installed Ollama model.`
              : `Task ${request.task ?? "generic-analysis"} is local-preferred but no installed local model was detected.`,
        offlineCapable: Boolean(configuredLocal ?? fallbackLocal ?? anyLocalModel)
      };
    }

    if (this.cloudEnabled) {
      return {
        preferredRoute,
        selectedRoute: "cloud",
        provider: inferCloudProvider(this.config.cloudModel),
        model: this.config.cloudModel,
        reason: `Task ${request.task ?? "generic-analysis"} is cloud-preferred and cloud execution is enabled.`,
        offlineCapable: false
      };
    }

    const localFallback = configuredLocal ?? fallbackLocal ?? anyLocalModel;
    if (localFallback) {
      return {
        preferredRoute,
        selectedRoute: "local",
        provider: "ollama",
        model: localFallback,
        reason: `Task ${request.task ?? "generic-analysis"} is cloud-preferred, but cloud execution is disabled; using a local Ollama fallback.`,
        offlineCapable: true
      };
    }

    return {
      preferredRoute,
      selectedRoute: "cloud",
      provider: inferCloudProvider(this.config.cloudModel),
      model: this.config.cloudModel,
      reason: `Task ${request.task ?? "generic-analysis"} is cloud-preferred and no local fallback model is available.`,
      offlineCapable: false
    };
  }

  async ask(input: string | AIRouterRequest): Promise<string> {
    const request = normalizeRequest(input);
    const selection = await this.selectModel(request);
    this.logger.info("AI route selected", {
      component: "ai-router",
      action: "route_select",
      task: request.task ?? "generic-analysis",
      provider: selection.provider,
      model: selection.model,
      selectedRoute: selection.selectedRoute,
      preferredRoute: selection.preferredRoute
    });

    if (selection.selectedRoute === "local") {
      if (!selection.offlineCapable) {
        throw new Error(`No local Ollama model is available for task ${request.task ?? "generic-analysis"}.`);
      }

      const composedPrompt = request.context
        ? `${request.prompt.trim()}\n\nAdditional context:\n${request.context.trim()}`
        : request.prompt;
      return this.localAdapter.ask(composedPrompt, selection.model);
    }

    throw new Error(
      `Cloud model routing selected ${selection.provider}:${selection.model}, but cloud execution is not enabled in this runtime. Configure a cloud adapter or ensure an Ollama fallback model is available.`
    );
  }
}
