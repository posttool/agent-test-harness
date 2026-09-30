import { z } from "zod";
import { ModelRefSchema } from "./ModelRef.ts";

/** Replaces the primary model and/or the fallback chain for one role. */
export const RoleModelOverrideSchema = z.object({
  primary: ModelRefSchema.optional(),
  fallbacks: z.array(ModelRefSchema).optional(),
});

export type RoleModelOverride = z.infer<typeof RoleModelOverrideSchema>;
