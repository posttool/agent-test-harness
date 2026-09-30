import { z } from "zod";

/** Token usage and cost for one model call. */
export const UsageSchema = z.object({
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadTokens: z.number().int().default(0),
  cacheWriteTokens: z.number().int().default(0),
  costUsd: z.number().nullable(),
});

export type Usage = z.infer<typeof UsageSchema>;
