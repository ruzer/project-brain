import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_OLLAMA_TIMEOUT_MS,
  OllamaAdapter,
  type LocalModelAdapter,
  type OllamaModelDescriptor,
  type OllamaModelResidency
} from "../../integrations/ollama_adapter";
import { StructuredLogger } from "../../shared/logger";

export type ModelRoute = "local" | "cloud";
export type LocalProvider = "ollama";
export type CloudProvider = "openai" | "codex" | "gemini";
export type ModelProvider = LocalProvider | CloudProvider;
export type ModelProfile = "worker" | "reviewer" | "reasoning" | "planner" | "synthesizer";
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
  | "intent-routing"
  | "report-synthesis"
  | "generic-analysis";

export interface ModelProfileConfig {
  worker: string;
  reviewer: string;
  reasoning: string;
  planner: string;
  synthesizer: string;
}

export interface ModelConfig {
  localModel: string;
  cloudModel: string;
  fallbackModel: string;
  reasoningModel: string;
  offlineMode: boolean;
  allowRemoteOllama: boolean;
  ollamaTimeoutMs: number;
  profiles: ModelProfileConfig;
  routing: Partial<Record<AIRouterTask, ModelRoute>>;
  taskProfiles: Partial<Record<AIRouterTask, ModelProfile>>;
}

export interface ModelSelection {
  preferredRoute: ModelRoute;
  selectedRoute: ModelRoute;
  provider: ModelProvider;
  model: string;
  profile: ModelProfile;
  residency: OllamaModelResidency | "remote";
  reason: string;
  offlineCapable: boolean;
}

export interface ModelInventory {
  config: ModelConfig;
  localProvider: LocalProvider;
  localModelsAvailable: string[];
  availableModels: OllamaModelDescriptor[];
  localConfigured: string;
  fallbackConfigured: string;
  resolvedProfiles: Record<ModelProfile, string>;
  cloudConfigured: {
    provider: CloudProvider;
    model: string;
  };
  routing: Partial<Record<AIRouterTask, ModelRoute>>;
  taskProfiles: Partial<Record<AIRouterTask, ModelProfile>>;
  offlineMode: boolean;
  remoteOllamaAllowed: boolean;
  offlineReady: boolean;
}

export interface AIRouterRequest {
  task?: AIRouterTask;
  prompt: string;
  context?: string;
  profile?: ModelProfile;
  allowRemote?: boolean;
  timeoutMs?: number;
}

interface AIRouterOptions {
  config?: Partial<ModelConfig>;
  localAdapter?: LocalModelAdapter;
  cloudEnabled?: boolean;
}

interface ModelMatch {
  descriptor: OllamaModelDescriptor;
  candidate: string;
  strategy: "profile" | "fallback";
}

const DEFAULT_ROUTING: Partial<Record<AIRouterTask, ModelRoute>> = {
  "repository-scanning": "local",
  "code-smell-detection": "local",
  "ux-audit": "local",
  "ux-improvement": "local",
  "qa-analysis": "local",
  "performance-analysis": "local",
  "documentation-review": "local",
  "intent-routing": "cloud",
  "report-synthesis": "local",
  "architecture-review": "cloud",
  "large-refactor-analysis": "cloud",
  "generic-analysis": "local"
};

const DEFAULT_TASK_PROFILES: Partial<Record<AIRouterTask, ModelProfile>> = {
  "repository-scanning": "worker",
  "code-smell-detection": "reviewer",
  "ux-audit": "reviewer",
  "ux-improvement": "reviewer",
  "qa-analysis": "reviewer",
  "performance-analysis": "reviewer",
  "documentation-review": "synthesizer",
  "intent-routing": "planner",
  "report-synthesis": "synthesizer",
  "architecture-review": "planner",
  "large-refactor-analysis": "planner",
  "generic-analysis": "worker"
};

const DEFAULT_PROFILES: ModelProfileConfig = {
  worker: "qwen2.5-coder:7b",
  reviewer: "deepseek-coder:6.7b",
  reasoning: "llama3.1:8b",
  planner: "kimi-k2.5:cloud",
  synthesizer: "llama3.1:8b"
};

function parseTimeoutMs(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }

  return numeric;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }

  return undefined;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

const DEFAULT_OLLAMA_TIMEOUT = parseTimeoutMs(process.env.OLLAMA_TIMEOUT_MS) ?? DEFAULT_OLLAMA_TIMEOUT_MS;

const DEFAULT_CONFIG: ModelConfig = {
  localModel: DEFAULT_PROFILES.worker,
  cloudModel: "gpt-4.1",
  fallbackModel: DEFAULT_PROFILES.reviewer,
  reasoningModel: DEFAULT_PROFILES.reasoning,
  offlineMode: true,
  allowRemoteOllama: true,
  ollamaTimeoutMs: DEFAULT_OLLAMA_TIMEOUT,
  profiles: { ...DEFAULT_PROFILES },
  routing: { ...DEFAULT_ROUTING },
  taskProfiles: { ...DEFAULT_TASK_PROFILES }
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
  /system\s+redesign/i,
  /strategy/i,
  /roadmap/i,
  /deploy/i
];

const PROMPT_SYNTHESIS_HINTS = [
  /synthesi[sz]e/i,
  /summary/i,
  /resumen/i,
  /executive/i,
  /brief/i,
  /handoff/i
];

const PROMPT_REASONING_HINTS = [
  /trade-?off/i,
  /reason/i,
  /compare/i,
  /decision/i,
  /scope/i,
  /alcance/i
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
      reasoning_model?: string;
      reasoningModel?: string;
      offline_mode?: boolean | string;
      allow_remote_ollama?: boolean | string;
      allowRemoteOllama?: boolean | string;
      worker_model?: string;
      workerModel?: string;
      reviewer_model?: string;
      reviewerModel?: string;
      planner_model?: string;
      plannerModel?: string;
      synthesizer_model?: string;
      synthesizerModel?: string;
      profiles?: Partial<ModelProfileConfig>;
      ollama_timeout_ms?: number;
      routing?: Partial<Record<AIRouterTask, ModelRoute>>;
      task_profiles?: Partial<Record<AIRouterTask, ModelProfile>>;
      taskProfiles?: Partial<Record<AIRouterTask, ModelProfile>>;
    };

    const workerModel =
      parsed.profiles?.worker ??
      parsed.workerModel ??
      parsed.worker_model ??
      parsed.localModel ??
      parsed.local_model ??
      parsed.local ??
      DEFAULT_CONFIG.localModel;
    const fallbackModel = parsed.fallbackModel ?? parsed.fallback_model ?? parsed.fallback ?? DEFAULT_CONFIG.fallbackModel;
    const reasoningModel =
      parsed.profiles?.reasoning ??
      parsed.reasoningModel ??
      parsed.reasoning_model ??
      DEFAULT_CONFIG.reasoningModel;
    const profiles: ModelProfileConfig = {
      worker: workerModel,
      reviewer: parsed.profiles?.reviewer ?? parsed.reviewerModel ?? parsed.reviewer_model ?? fallbackModel,
      reasoning: reasoningModel,
      planner: parsed.profiles?.planner ?? parsed.plannerModel ?? parsed.planner_model ?? DEFAULT_CONFIG.profiles.planner,
      synthesizer:
        parsed.profiles?.synthesizer ??
        parsed.synthesizerModel ??
        parsed.synthesizer_model ??
        reasoningModel
    };

    return {
      localModel: workerModel,
      cloudModel: parsed.cloudModel ?? parsed.cloud_model ?? parsed.cloud ?? DEFAULT_CONFIG.cloudModel,
      fallbackModel,
      reasoningModel,
      offlineMode: parseBoolean(parsed.offlineMode ?? parsed.offline_mode) ?? DEFAULT_CONFIG.offlineMode,
      allowRemoteOllama:
        parseBoolean(parsed.allowRemoteOllama ?? parsed.allow_remote_ollama) ?? DEFAULT_CONFIG.allowRemoteOllama,
      ollamaTimeoutMs: parseTimeoutMs(parsed.ollamaTimeoutMs ?? parsed.ollama_timeout_ms) ?? DEFAULT_CONFIG.ollamaTimeoutMs,
      profiles,
      routing: {
        ...DEFAULT_ROUTING,
        ...(parsed.routing ?? {})
      },
      taskProfiles: {
        ...DEFAULT_TASK_PROFILES,
        ...(parsed.taskProfiles ?? parsed.task_profiles ?? {})
      }
    };
  } catch {
    return {
      ...DEFAULT_CONFIG,
      profiles: { ...DEFAULT_CONFIG.profiles },
      routing: { ...DEFAULT_ROUTING },
      taskProfiles: { ...DEFAULT_TASK_PROFILES }
    };
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

function createLocalDescriptor(model: string): OllamaModelDescriptor {
  return {
    name: withDefaultTag(model),
    residency: "local",
    offlineCapable: true
  };
}

function resolveDescriptor(preferred: string, available: OllamaModelDescriptor[]): OllamaModelDescriptor | undefined {
  const exact = available.find((model) => model.name === preferred || model.name === withDefaultTag(preferred));
  if (exact) {
    return exact;
  }

  return available.find((model) => model.name === preferred || model.name.startsWith(`${preferred}:`));
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
    context: request.context,
    profile: request.profile,
    allowRemote: request.allowRemote,
    timeoutMs: request.timeoutMs
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

function inferPreferredProfile(request: AIRouterRequest, config: ModelConfig): ModelProfile {
  if (request.profile) {
    return request.profile;
  }

  if (request.task && config.taskProfiles[request.task]) {
    return config.taskProfiles[request.task] as ModelProfile;
  }

  if (PROMPT_SYNTHESIS_HINTS.some((rule) => rule.test(request.prompt))) {
    return "synthesizer";
  }

  if (PROMPT_CLOUD_HINTS.some((rule) => rule.test(request.prompt))) {
    return "planner";
  }

  if (PROMPT_REASONING_HINTS.some((rule) => rule.test(request.prompt))) {
    return "reasoning";
  }

  if (/review|audit|qa|bug|smell/i.test(request.prompt)) {
    return "reviewer";
  }

  return "worker";
}

function profileCandidates(profile: ModelProfile, config: ModelConfig): string[] {
  const candidatesByProfile: Record<ModelProfile, string[]> = {
    worker: [config.profiles.worker, config.localModel, config.fallbackModel, config.reasoningModel],
    reviewer: [config.profiles.reviewer, config.fallbackModel, config.localModel, config.reasoningModel],
    reasoning: [config.profiles.reasoning, config.reasoningModel, config.profiles.synthesizer, config.localModel],
    planner: [config.profiles.planner, config.profiles.reasoning, config.reasoningModel, config.localModel, config.fallbackModel],
    synthesizer: [config.profiles.synthesizer, config.profiles.reasoning, config.reasoningModel, config.localModel, config.fallbackModel]
  };

  return unique(candidatesByProfile[profile].filter(Boolean));
}

function allowRemoteForRequest(request: AIRouterRequest, profile: ModelProfile, config: ModelConfig): boolean {
  if (typeof request.allowRemote === "boolean") {
    return request.allowRemote;
  }

  if (!config.allowRemoteOllama) {
    return false;
  }

  if (!config.offlineMode) {
    return true;
  }

  return profile === "planner" || profile === "synthesizer";
}

function buildOllamaReason(match: ModelMatch, task: AIRouterTask, profile: ModelProfile, preferredRoute: ModelRoute): string {
  const residencyText = match.descriptor.residency === "local" ? "local" : "remote";
  const fallbackNote =
    match.strategy === "fallback" ? ` The configured ${profile} profile was unavailable, so the router fell back.` : "";
  const routeNote =
    preferredRoute === "cloud" && match.descriptor.residency === "local"
      ? " Cloud-preferred work was kept local because no planner-grade remote model was required."
      : preferredRoute === "local" && match.descriptor.residency === "remote"
        ? " The task still runs through Ollama, but this model is not offline-capable."
        : "";

  return `Task ${task} will use the ${profile} profile on the ${residencyText} Ollama model ${match.descriptor.name}.${fallbackNote}${routeNote}`;
}

export class AIRouter {
  private readonly logger = new StructuredLogger("ai-router");
  private readonly config: ModelConfig;
  private readonly localAdapter: LocalModelAdapter;
  private readonly cloudEnabled: boolean;

  constructor(options: AIRouterOptions = {}) {
    const diskConfig = loadConfigFromDisk();
    this.config = {
      ...diskConfig,
      ...options.config,
      profiles: {
        ...diskConfig.profiles,
        ...(options.config?.profiles ?? {})
      },
      routing: {
        ...diskConfig.routing,
        ...(options.config?.routing ?? {})
      },
      taskProfiles: {
        ...diskConfig.taskProfiles,
        ...(options.config?.taskProfiles ?? {})
      }
    };
    this.localAdapter = options.localAdapter ?? new OllamaAdapter(undefined, this.config.ollamaTimeoutMs);
    this.cloudEnabled = options.cloudEnabled ?? false;
  }

  routeForPrompt(request: string | AIRouterRequest): ModelRoute {
    return inferPreferredRoute(normalizeRequest(request), this.config);
  }

  private async listAvailableModels(): Promise<OllamaModelDescriptor[]> {
    const descriptors = this.localAdapter.listModelDescriptors ? await this.localAdapter.listModelDescriptors() : undefined;
    if (descriptors && descriptors.length > 0) {
      return descriptors
        .slice()
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((descriptor) => ({
          ...descriptor,
          name: descriptor.name,
          residency: descriptor.residency,
          offlineCapable: descriptor.offlineCapable
        }));
    }

    return (await this.localAdapter.listModels())
      .map((model) => createLocalDescriptor(model))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listModels(): Promise<ModelInventory> {
    const availableModels = await this.listAvailableModels();
    const localModelsAvailable = availableModels.map((model) => model.name);
    const resolveConfigured = (value: string) => resolveDescriptor(value, availableModels)?.name ?? value;

    return {
      config: {
        ...this.config,
        profiles: { ...this.config.profiles },
        routing: { ...this.config.routing },
        taskProfiles: { ...this.config.taskProfiles }
      },
      localProvider: "ollama",
      localModelsAvailable,
      availableModels,
      localConfigured: resolveConfigured(this.config.localModel),
      fallbackConfigured: resolveConfigured(this.config.fallbackModel),
      resolvedProfiles: {
        worker: resolveConfigured(this.config.profiles.worker),
        reviewer: resolveConfigured(this.config.profiles.reviewer),
        reasoning: resolveConfigured(this.config.profiles.reasoning),
        planner: resolveConfigured(this.config.profiles.planner),
        synthesizer: resolveConfigured(this.config.profiles.synthesizer)
      },
      cloudConfigured: {
        provider: inferCloudProvider(this.config.cloudModel),
        model: this.config.cloudModel
      },
      routing: { ...this.config.routing },
      taskProfiles: { ...this.config.taskProfiles },
      offlineMode: this.config.offlineMode,
      remoteOllamaAllowed: this.config.allowRemoteOllama,
      offlineReady: availableModels.some((model) => model.offlineCapable)
    };
  }

  private matchOllamaModel(profile: ModelProfile, available: OllamaModelDescriptor[]): ModelMatch | undefined {
    const primaryCandidates = profileCandidates(profile, this.config);
    for (const candidate of primaryCandidates) {
      const descriptor = resolveDescriptor(candidate, available);
      if (descriptor) {
        return {
          descriptor,
          candidate,
          strategy: "profile"
        };
      }
    }

    const fallbackCandidates = unique([this.config.localModel, this.config.fallbackModel, this.config.reasoningModel]);
    for (const candidate of fallbackCandidates) {
      const descriptor = resolveDescriptor(candidate, available);
      if (descriptor) {
        return {
          descriptor,
          candidate,
          strategy: "fallback"
        };
      }
    }

    if (available[0]) {
      return {
        descriptor: available[0],
        candidate: available[0].name,
        strategy: "fallback"
      };
    }

    return undefined;
  }

  async selectModel(input: string | AIRouterRequest): Promise<ModelSelection> {
    const request = normalizeRequest(input);
    const preferredRoute = inferPreferredRoute(request, this.config);
    const preferredProfile = inferPreferredProfile(request, this.config);
    const inventory = await this.listModels();
    const allowRemote = allowRemoteForRequest(request, preferredProfile, this.config);
    const allowedOllamaModels = inventory.availableModels.filter((model) => allowRemote || model.offlineCapable);
    const match = this.matchOllamaModel(preferredProfile, allowedOllamaModels);

    if (match) {
      return {
        preferredRoute,
        selectedRoute: match.descriptor.offlineCapable ? "local" : "cloud",
        provider: "ollama",
        model: match.descriptor.name,
        profile: preferredProfile,
        residency: match.descriptor.residency,
        reason: buildOllamaReason(match, request.task ?? "generic-analysis", preferredProfile, preferredRoute),
        offlineCapable: match.descriptor.offlineCapable
      };
    }

    if (preferredRoute === "cloud" && this.cloudEnabled) {
      return {
        preferredRoute,
        selectedRoute: "cloud",
        provider: inferCloudProvider(this.config.cloudModel),
        model: this.config.cloudModel,
        profile: preferredProfile,
        residency: "remote",
        reason: `Task ${request.task ?? "generic-analysis"} is cloud-preferred and no Ollama profile match was available.`,
        offlineCapable: false
      };
    }

    return {
      preferredRoute,
      selectedRoute: preferredRoute,
      provider: inferCloudProvider(this.config.cloudModel),
      model: this.config.cloudModel,
      profile: preferredProfile,
      residency: "remote",
      reason: `Task ${request.task ?? "generic-analysis"} had no matching Ollama model for the ${preferredProfile} profile.`,
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
      profile: selection.profile,
      residency: selection.residency,
      selectedRoute: selection.selectedRoute,
      preferredRoute: selection.preferredRoute
    });

    if (selection.provider === "ollama") {
      const composedPrompt = request.context
        ? `${request.prompt.trim()}\n\nAdditional context:\n${request.context.trim()}`
        : request.prompt;
      return this.localAdapter.ask(composedPrompt, selection.model, {
        timeoutMs: request.timeoutMs
      });
    }

    throw new Error(
      `Cloud model routing selected ${selection.provider}:${selection.model}, but cloud execution is not enabled in this runtime. Configure a cloud adapter or ensure an Ollama fallback model is available.`
    );
  }
}
