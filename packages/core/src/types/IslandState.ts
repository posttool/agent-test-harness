import { z } from "zod";

/** The Dynamic Island: pulsing when the agent is reasoning, with one or two words. */
export const IslandStateSchema = z.object({
  active: z.boolean(),
  words: z.string().nullable(),
});

export type IslandState = z.infer<typeof IslandStateSchema>;
