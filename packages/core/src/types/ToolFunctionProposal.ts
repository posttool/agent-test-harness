import { z } from "zod";
import { OversightLevelSchema } from "./OversightLevel.ts";

/** LLM output part: a function in a proposed tool. */
export const ToolFunctionProposalSchema = z.object({
  name: z.string(),
  description: z.string(),
  paramsJsonSchema: z.string().describe("JSON Schema for the arguments, as a JSON string."),
  returnsJsonSchema: z.string().describe("JSON Schema for the result, as a JSON string."),
  oversight: OversightLevelSchema,
  longRunning: z.boolean(),
});

export type ToolFunctionProposal = z.infer<typeof ToolFunctionProposalSchema>;
