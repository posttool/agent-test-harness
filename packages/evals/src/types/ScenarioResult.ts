import { z } from "zod";
import { JudgeVerdictSchema } from "@harness/core";

/** One scenario run on one provider. */
export const ScenarioResultSchema = z.object({
  scenarioId: z.string(),
  provider: z.string(),
  verdict: JudgeVerdictSchema.nullable(),
  error: z.string().nullable(),
  sessions: z.number().int(),
  failedSessions: z.number().int(),
  steps: z.number().int(),
  modelCalls: z.number().int(),
  fallbacks: z.number().int(),
  uiAnswers: z.number().int(),
  wallMs: z.number(),
  costUsd: z.number().nullable(),
  tokens: z.object({ input: z.number(), output: z.number() }),
  evidence: z.string(),
});

export type ScenarioResult = z.infer<typeof ScenarioResultSchema>;
