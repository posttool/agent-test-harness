import { z } from "zod";

/** One observation from a persona's day, as `listObservations1` returns it. */
export const PersonaObservationSchema = z.object({
  id: z.string(),
  date: z.string(),
  time: z.string(),
  device: z.string().nullable().default(null),
  type: z.string().nullable().default(null),
  senderApp: z.string().nullable().default(null),
  sender: z.string().nullable().default(null),
  data: z.string(),
});

export type PersonaObservation = z.infer<typeof PersonaObservationSchema>;
