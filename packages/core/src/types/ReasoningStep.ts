import { z } from "zod";

/** One capability run inside a session. */
export const ReasoningStepSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  index: z.number().int(),
  capability: z.string(),
  instruction: z.string(),
  rationale: z.string(),
  status: z.enum(["running", "ok", "failed", "awaiting_ui"]),
  output: z.unknown(),
  error: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export type ReasoningStep = z.infer<typeof ReasoningStepSchema>;
