import { z } from "zod";
import { ToolProposalSchema } from "./ToolProposal.ts";

/** LLM output: how to get a tool for the need. */
export const ToolDiscoveryResultSchema = z.object({
  strategy: z.enum(["recall", "web_search", "wrap_api", "wrap_mcp", "llm_tool", "generate_code", "none"]),
  toolId: z.string().nullable().describe("An existing tool to use, when recalling."),
  proposal: ToolProposalSchema.nullable(),
  rationale: z.string(),
});

export type ToolDiscoveryResult = z.infer<typeof ToolDiscoveryResultSchema>;
