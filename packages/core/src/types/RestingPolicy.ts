import { z } from "zod";

/** Retry, rest and budget settings (PLAN.md section 4.5). */
export const RestingPolicySchema = z.object({
  maxAttempts: z.number().int().default(4),
  baseDelayMs: z.number().int().default(1_000),
  factor: z.number().default(2),
  maxDelayMs: z.number().int().default(30_000),
  schemaRetries: z.number().int().default(1),
  restAfterFailures: z.number().int().default(3),
  failureWindowMs: z.number().int().default(120_000),
  restMs: z.number().int().default(60_000),
  maxRestMs: z.number().int().default(600_000),
  stepBudgetMs: z.number().int().default(180_000),
});

export type RestingPolicy = z.infer<typeof RestingPolicySchema>;
