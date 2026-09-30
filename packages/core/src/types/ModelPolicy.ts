import { z } from "zod";
import { ModelRefSchema } from "./ModelRef.ts";
import { RestingPolicySchema } from "./RestingPolicy.ts";
import { RoleModelOverrideSchema } from "./RoleModelOverride.ts";
import { ModelRoleSchema } from "./ModelRole.ts";
import { EffortLevelSchema } from "./EffortLevel.ts";

/** Which models each role uses, in what order, and how failures are handled. */
export const ModelPolicySchema = z.object({
  primary: ModelRefSchema,
  fallbacks: z.array(ModelRefSchema),
  roles: z.partialRecord(ModelRoleSchema, RoleModelOverrideSchema).default({}),
  effort: z.record(ModelRoleSchema, EffortLevelSchema),
  resting: RestingPolicySchema,
  timeoutMs: z.number().int().default(60_000),
  maxOutputTokens: z.number().int().default(16_000),
});

export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
