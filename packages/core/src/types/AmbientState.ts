import { z } from "zod";
import { AmbientSourceSchema } from "./AmbientSource.ts";
import { AmbientEventSchema } from "./AmbientEvent.ts";

/** The Data panel's view of the ambient engine. */
export const AmbientStateSchema = z.object({
  enabled: z.boolean(),
  speed: z.number().describe("Virtual seconds per real second."),
  virtualNow: z.number(),
  running: z.boolean(),
  sources: z.array(AmbientSourceSchema),
  recentEvents: z.array(AmbientEventSchema),
});

export type AmbientState = z.infer<typeof AmbientStateSchema>;
