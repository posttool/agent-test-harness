import { z } from "zod";
import { AmbientKindSchema } from "./AmbientKind.ts";

/** A simulated stream of real-world events. */
export const AmbientSourceSchema = z.object({
  id: z.string(),
  kind: AmbientKindSchema,
  name: z.string(),
  templateId: z.string().nullable(),
  ratePerMinute: z.number(),
  /** Per-source emission speed multiplier on top of the global clock. */
  speed: z.number().default(1),
  enabled: z.boolean(),
  /** Virtual time (ms) the source started; scripted event offsets count from here. */
  startedAt: z.number().nullable().default(null),
  /** How many scripted events have been emitted. */
  cursor: z.number().int().default(0),
  lifecycle: z.enum(["persistent", "until_complete"]),
  ownerSubscriptionId: z.string().nullable(),
  definition: z.record(z.string(), z.unknown()),
});

export type AmbientSource = z.infer<typeof AmbientSourceSchema>;
