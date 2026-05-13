import { describe, expect, it } from "vitest";

import { applyPresetPolicy } from "../../core/token_policy";
import type { AIRouterRequest } from "../../core/ai_router/router";

const request: AIRouterRequest = {
  task: "generic-analysis",
  profile: "worker",
  prompt: "Return findings."
};

describe("token preset policy", () => {
  it("adds the cheap preset marker and concise instruction", () => {
    const result = applyPresetPolicy(request, "cheap");

    expect(result.prompt).toContain("[project-brain-preset-policy:v1]");
    expect(result.prompt).toContain("Be maximally concise. Return only the top 3 findings.");
  });

  it("leaves balanced prompts unchanged", () => {
    expect(applyPresetPolicy(request, "balanced").prompt).toBe(request.prompt);
  });

  it("adds the thorough preset marker and exhaustive instruction", () => {
    const result = applyPresetPolicy(request, "thorough");

    expect(result.prompt).toContain("[project-brain-preset-policy:v1]");
    expect(result.prompt).toContain("Be exhaustive. Include all evidence_refs.");
  });
});
