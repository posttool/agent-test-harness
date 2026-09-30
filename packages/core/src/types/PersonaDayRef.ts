import { z } from "zod";

/** A simulated day, as `listDaysForPersona1` returns it. */
export const PersonaDayRefSchema = z.object({
  id: z.string(),
  date: z.string(),
});

export type PersonaDayRef = z.infer<typeof PersonaDayRefSchema>;
