import { z } from "zod";

/** LLM output: an eval judge's verdict on one scenario. */
export const JudgeVerdictSchema = z.object({
  pass: z.boolean(),
  score: z.number().describe("0 to 1."),
  reasons: z.array(z.string()),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;
