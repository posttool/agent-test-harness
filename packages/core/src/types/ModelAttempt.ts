import { z } from "zod";
import { ModelRoleSchema } from "./ModelRole.ts";
import { ProviderIdSchema } from "./ProviderId.ts";
import { ModelErrorKindSchema } from "./ModelErrorKind.ts";
import { UsageSchema } from "./Usage.ts";

/** One try against one model, recorded in traces. */
export const ModelAttemptSchema = z.object({
  role: ModelRoleSchema,
  provider: ProviderIdSchema,
  model: z.string(),
  attempt: z.number().int(),
  outcome: z.enum(["ok", "error", "skipped_resting", "skipped_auth"]),
  errorKind: ModelErrorKindSchema.nullable(),
  errorMessage: z.string().nullable(),
  delayBeforeMs: z.number().int(),
  latencyMs: z.number().int(),
  usage: UsageSchema.nullable(),
});

export type ModelAttempt = z.infer<typeof ModelAttemptSchema>;
