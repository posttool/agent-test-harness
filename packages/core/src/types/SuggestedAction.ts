import { z } from "zod";

/** An action the agent can offer from a Document. */
export const SuggestedActionSchema = z.object({
  label: z.string(),
  toolId: z.string().nullable(),
  functionName: z.string().nullable(),
});

export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
