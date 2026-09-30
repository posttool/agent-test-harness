import { z } from "zod";
import { SignalKindSchema } from "@harness/core";

/** One thing that happens in a scenario, at a virtual time. */
export const ScenarioStepSchema = z.object({
  atMinute: z.number().describe("Virtual minutes after the scenario starts."),
  kind: SignalKindSchema.default("user_text"),
  source: z.string().default("home input bar"),
  content: z.string(),
});

export type ScenarioStep = z.infer<typeof ScenarioStepSchema>;
