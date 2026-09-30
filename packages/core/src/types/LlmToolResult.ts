import { z } from "zod";

/** LLM output: the result of a tool implemented by a differently grounded LLM. */
export const LlmToolResultSchema = z.object({
  resultJson: z.string().describe("The function's result as a JSON string matching its return schema."),
  note: z.string().describe("One sentence on what was done."),
});

export type LlmToolResult = z.infer<typeof LlmToolResultSchema>;
