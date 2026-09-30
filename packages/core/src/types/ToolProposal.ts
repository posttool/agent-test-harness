import { z } from "zod";
import { ToolSourceSchema } from "./ToolSource.ts";
import { ToolFunctionProposalSchema } from "./ToolFunctionProposal.ts";

/** LLM output part: a new tool the agent wants to create. */
export const ToolProposalSchema = z.object({
  name: z.string(),
  description: z.string(),
  source: ToolSourceSchema,
  functions: z.array(ToolFunctionProposalSchema),
  endpoint: z.string().nullable(),
  code: z.string().nullable(),
});

export type ToolProposal = z.infer<typeof ToolProposalSchema>;
