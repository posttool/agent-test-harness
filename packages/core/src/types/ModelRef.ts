import { z } from "zod";
import { ProviderIdSchema } from "./ProviderId.ts";

/** A specific model at a specific provider. */
export const ModelRefSchema = z.object({
  provider: ProviderIdSchema,
  model: z.string(),
  /** Claude only: send `fallbacks: "default"` so refusals are retried server-side. */
  serverFallback: z.boolean().default(false),
});

export type ModelRef = z.infer<typeof ModelRefSchema>;
