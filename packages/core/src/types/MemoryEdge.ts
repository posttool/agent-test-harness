import { z } from "zod";
import { EdgeTypeSchema } from "./EdgeType.ts";

/** A directed edge in the memory graph. */
export const MemoryEdgeSchema = z.object({
  id: z.string(),
  type: EdgeTypeSchema,
  from: z.string(),
  to: z.string(),
  version: z.number().int(),
  sourceEventIds: z.array(z.string()),
  createdAt: z.string(),
});

export type MemoryEdge = z.infer<typeof MemoryEdgeSchema>;
