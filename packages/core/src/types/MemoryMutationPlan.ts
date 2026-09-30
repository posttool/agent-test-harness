import { z } from "zod";
import { MemoryMutationSchema } from "./MemoryMutation.ts";

/** LLM output: how to merge new information into memory. */
export const MemoryMutationPlanSchema = z.object({
  rationale: z.string(),
  operations: z.array(MemoryMutationSchema),
  needsUserConfirmation: z.boolean().describe("True when the facts are uncertain and the user should confirm first."),
  question: z.string().nullable().describe("The question to ask when confirmation is needed."),
});

export type MemoryMutationPlan = z.infer<typeof MemoryMutationPlanSchema>;
