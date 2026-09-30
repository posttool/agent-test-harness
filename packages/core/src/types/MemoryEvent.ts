import { z } from "zod";

/** Append-only audit record. The graph is built from these. */
export const MemoryEventSchema = z.object({
  id: z.string(),
  at: z.string(),
  kind: z.enum(["ingested", "mutation", "organize", "user_edit"]),
  signalId: z.string().nullable(),
  sessionId: z.string().nullable(),
  description: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type MemoryEvent = z.infer<typeof MemoryEventSchema>;
