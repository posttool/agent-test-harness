import { ModelPolicySchema, type ModelPolicy } from "../types/ModelPolicy.ts";

/**
 * The default policy (PLAN.md section 4.5): Claude Opus 5.5 for every role, then the
 * previous Opus, then Gemini. Effort values are starting points that M8 tunes.
 */
export const DEFAULT_MODEL_POLICY: ModelPolicy = ModelPolicySchema.parse({
  primary: { provider: "claude", model: "claude-opus-5-5", serverFallback: true },
  fallbacks: [
    { provider: "claude", model: "claude-opus-5", serverFallback: true },
    { provider: "gemini", model: "gemini-3.8-flash" },
    { provider: "gemini", model: "gemini-3.7-flash" },
  ],
  effort: { loop: "high", router: "low", memoryMerge: "medium", device: "medium", judge: "high" },
  resting: {},
});
