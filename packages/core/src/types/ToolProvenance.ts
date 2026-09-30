import { z } from "zod";

/** How a tool came to exist. */
export const ToolProvenanceSchema = z.object({
  discoveredVia: z.string(),
  createdAt: z.string(),
  createdBySessionId: z.string().nullable(),
});

export type ToolProvenance = z.infer<typeof ToolProvenanceSchema>;
