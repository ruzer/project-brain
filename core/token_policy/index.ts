import type { AIRouterRequest, ModelProfile } from "../ai_router/router";

const TOKEN_POLICY_MARKER = "[project-brain-token-policy:v1]";
const PRESET_POLICY_MARKER = "[project-brain-preset-policy:v1]";

export type TokenPreset = "cheap" | "balanced" | "thorough";

function policyForProfile(profile: ModelProfile | undefined): string[] {
  const common = [
    TOKEN_POLICY_MARKER,
    "Be concise and structured.",
    "Do not repeat the prompt or restate obvious context.",
    "Do not invent paths, APIs, versions, entities, or relationships.",
    "Use UNKNOWN when evidence is missing.",
    "Prefer JSON or compact bullets when the prompt asks for structured output."
  ];

  if (profile === "worker" || profile === "reviewer") {
    return [
      ...common,
      "Return only findings that are supported by provided repository context.",
      "Limit findings, recommendations, evidence_refs, and unknowns to the highest-signal items."
    ];
  }

  if (profile === "synthesizer") {
    return [
      ...common,
      "Deduplicate worker outputs aggressively.",
      "Keep verified facts separate from priorities and next steps."
    ];
  }

  if (profile === "planner") {
    return [
      ...common,
      "Plan the smallest useful task set.",
      "Avoid broad scans when existing artifacts or narrow scopes can answer the request."
    ];
  }

  return common;
}

export function applyTokenPolicy(request: AIRouterRequest): AIRouterRequest {
  if (request.prompt.includes(TOKEN_POLICY_MARKER)) {
    return request;
  }

  const policy = policyForProfile(request.profile).join("\n");
  return {
    ...request,
    prompt: `${policy}\n\n${request.prompt.trim()}`
  };
}

export function applyPresetPolicy(request: AIRouterRequest, preset: TokenPreset = "balanced"): AIRouterRequest {
  if (preset === "balanced" || request.prompt.includes(PRESET_POLICY_MARKER)) {
    return request;
  }

  const presetInstruction =
    preset === "cheap"
      ? "Be maximally concise. Return only the top 3 findings. Omit evidence_refs longer than one path."
      : "Be exhaustive. Include all evidence_refs. Do not truncate findings or unknowns.";

  return {
    ...request,
    prompt: `${PRESET_POLICY_MARKER}\n${presetInstruction}\n\n${request.prompt.trim()}`
  };
}

export function tokenPolicyMarker(): string {
  return TOKEN_POLICY_MARKER;
}
