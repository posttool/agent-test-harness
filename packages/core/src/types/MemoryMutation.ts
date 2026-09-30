import { z } from "zod";

/** LLM output part: one change to the memory graph. */
export const MemoryMutationSchema = z.object({
  op: z.enum(["create_node", "update_node", "link", "unlink", "mark_stale", "archive", "delete"]),
  nodeId: z.string().nullable().describe("Existing node id, or the ref of a node created earlier in this plan."),
  ref: z.string().nullable().describe("Temporary ref for a node this plan creates, e.g. 'new-1'."),
  type: z.string().nullable().describe("Node type for create_node."),
  title: z.string().nullable(),
  summary: z.string().nullable(),
  attributesJson: z.string().nullable().describe("JSON object string of attributes to set, or null."),
  edgeType: z.string().nullable().describe("Edge type for link/unlink."),
  from: z.string().nullable(),
  to: z.string().nullable(),
  reason: z.string(),
});

export type MemoryMutation = z.infer<typeof MemoryMutationSchema>;
