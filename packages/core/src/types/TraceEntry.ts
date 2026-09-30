import { z } from "zod";
import { TraceKindSchema } from "./TraceKind.ts";

/** One entry in the reasoning trace, grouped by trigger. */
export const TraceEntrySchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  at: z.string(),
  kind: TraceKindSchema,
  triggerId: z.string().nullable(),
  sessionId: z.string().nullable(),
  stepId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
});

export type TraceEntry = z.infer<typeof TraceEntrySchema>;
