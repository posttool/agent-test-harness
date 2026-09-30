import { z } from "zod";

/** What arrived since the user last saw a topic. */
export const NoveltySummarySchema = z.object({
  summary: z.string(),
  novelty: z.number().describe("0 to 1; how much is new since the user last looked."),
});

export type NoveltySummary = z.infer<typeof NoveltySummarySchema>;
