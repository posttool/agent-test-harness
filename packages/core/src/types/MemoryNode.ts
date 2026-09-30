import { z } from "zod";
import { NodeTypeSchema } from "./NodeType.ts";

/** A node in the memory graph. */
export const MemoryNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  title: z.string(),
  summary: z.string(),
  attributes: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["live", "stale", "archived"]).default("live"),
  version: z.number().int(),
  sourceEventIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type MemoryNode = z.infer<typeof MemoryNodeSchema>;
