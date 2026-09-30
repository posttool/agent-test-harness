import { z } from "zod";

/** When a topic is contextually relevant. */
export const TriggerRuleSchema = z.object({
  kind: z.enum(["time", "semantic_location", "activity", "observation"]),
  qualifier: z
    .enum(["at", "before", "after", "during", "near", "far", "leaving", "arriving", "when_reach", "if_not", "when_arrives"])
    .nullable(),
  value: z.string().describe("e.g. 'mornings', 'grocery store', 'after workout', 'receipt received'"),
  rationale: z.string(),
});

export type TriggerRule = z.infer<typeof TriggerRuleSchema>;
