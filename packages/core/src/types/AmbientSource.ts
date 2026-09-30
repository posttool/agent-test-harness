import { z } from "zod";
import { AmbientKindSchema } from "./AmbientKind.ts";

/** A simulated stream of real-world events. */
export const AmbientSourceSchema = z.object({
  id: z.string(),
  kind: AmbientKindSchema,
  name: z.string(),
  templateId: z.string().nullable(),
  ratePerMinute: z.number(),
  enabled: z.boolean(),
  lifecycle: z.enum(["persistent", "until_complete"]),
  ownerSubscriptionId: z.string().nullable(),
  definition: z.record(z.string(), z.unknown()),
});

export type AmbientSource = z.infer<typeof AmbientSourceSchema>;
