import { z } from "zod";

/** LLM output part: one fact pulled from memory. */
export const MemoryFactSchema = z.object({
  nodeId: z.string(),
  statement: z.string(),
});

export type MemoryFact = z.infer<typeof MemoryFactSchema>;
