import { z } from "zod";

/** LLM output: where the TriggerRouter sends a signal. */
export const RouteDecisionSchema = z.object({
  action: z.enum(["new", "continue"]).describe("Start a new session, or continue an open one."),
  sessionId: z.string().nullable().describe("The open session to continue; null when action is new."),
  title: z.string().nullable().describe("Short title for a new session; null when continuing."),
  rationale: z.string().describe("One sentence on why."),
});

export type RouteDecision = z.infer<typeof RouteDecisionSchema>;
