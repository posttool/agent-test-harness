import { z } from "zod";
import { AmbientKindSchema } from "./AmbientKind.ts";

/** One event emitted by an ambient source. */
export const AmbientEventSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  kind: AmbientKindSchema,
  at: z.string().describe("Virtual-clock time."),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type AmbientEvent = z.infer<typeof AmbientEventSchema>;
