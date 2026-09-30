import { z } from "zod";
import { MemoryFactSchema } from "./MemoryFact.ts";

/** LLM output: what memory knows that matters for the current task. */
export const MemoryReadResultSchema = z.object({
  relevantNodeIds: z.array(z.string()),
  facts: z.array(MemoryFactSchema),
  gaps: z.array(z.string()).describe("Things the task needs that memory does not know."),
  summary: z.string(),
});

export type MemoryReadResult = z.infer<typeof MemoryReadResultSchema>;
