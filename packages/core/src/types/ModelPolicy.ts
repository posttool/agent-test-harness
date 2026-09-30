import { z } from "zod";
import { ModelRefSchema } from "./ModelRef.ts";
import { RestingPolicySchema } from "./RestingPolicy.ts";
import { RoleModelOverrideSchema } from "./RoleModelOverride.ts";
import { ModelRoleSchema } from "./ModelRole.ts";
import { EffortLevelSchema, type EffortLevel } from "./EffortLevel.ts";
import type { ModelRole } from "./ModelRole.ts";

const DEFAULT_EFFORT: Record<ModelRole, EffortLevel> = { loop: "high", router: "low", memoryMerge: "medium", device: "medium", judge: "high", simulator: "low", designer: "high" };

/** Which models each role uses, in what order, and how failures are handled. */
export const ModelPolicySchema = z.object({
  primary: ModelRefSchema,
  fallbacks: z.array(ModelRefSchema),
  roles: z.partialRecord(ModelRoleSchema, RoleModelOverrideSchema).default({}),
  // Settings saved before a role existed get that role's default effort.
  effort: z.partialRecord(ModelRoleSchema, EffortLevelSchema).transform((e) => ({ ...DEFAULT_EFFORT, ...e })),
  resting: RestingPolicySchema,
  timeoutMs: z.number().int().default(120_000),
  maxOutputTokens: z.number().int().default(16_000),
});

export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
