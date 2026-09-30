import { z } from "zod";

/** LLM output: the loop's choice of what to do next. */
export const NextStepDecisionSchema = z.object({
  action: z.enum(["step", "end"]).describe("Run another capability, or end the session."),
  capability: z.string().nullable().describe("Capability id to run next; null when ending."),
  instruction: z.string().nullable().describe("What the capability should do; null when ending."),
  rationale: z.string().describe("One or two sentences on why."),
  summary: z.string().nullable().describe("What the session accomplished; only when ending."),
});

export type NextStepDecision = z.infer<typeof NextStepDecisionSchema>;
