import { z } from "zod";
import { TriggerRuleSchema } from "./TriggerRule.ts";

/** A user preference that beats the agent's default triggers. */
export const TriggerOverrideSchema = z.object({
  kind: z.enum(["priority", "show", "hide"]),
  rule: TriggerRuleSchema.nullable(),
  priority: z.enum(["top", "high", "normal", "low"]).nullable(),
  note: z.string().describe("The user's own words, e.g. 'never on the weekend'."),
  createdAt: z.string(),
});

export type TriggerOverride = z.infer<typeof TriggerOverrideSchema>;
