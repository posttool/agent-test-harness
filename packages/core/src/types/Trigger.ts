import { z } from "zod";

/** A signal after routing: which session it started or continued. */
export const TriggerSchema = z.object({
  id: z.string(),
  signalId: z.string(),
  sessionId: z.string(),
  routedAt: z.string(),
  decision: z.enum(["new", "continue", "resume"]),
  rationale: z.string(),
});

export type Trigger = z.infer<typeof TriggerSchema>;
