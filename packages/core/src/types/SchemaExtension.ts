import { z } from "zod";

/** A node or edge type the model added beyond the core set. */
export const SchemaExtensionSchema = z.object({
  id: z.string(),
  kind: z.enum(["node_type", "edge_type"]),
  name: z.string(),
  description: z.string(),
  proposedBySessionId: z.string().nullable(),
  at: z.string(),
});

export type SchemaExtension = z.infer<typeof SchemaExtensionSchema>;
