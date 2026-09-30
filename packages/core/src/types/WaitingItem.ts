import { z } from "zod";
import { WaitingEntrySchema } from "./WaitingEntry.ts";

/** A WaitingEntry placed on the device, with an id the skin can act on. */
export const WaitingItemSchema = WaitingEntrySchema.extend({ id: z.string() });

export type WaitingItem = z.infer<typeof WaitingItemSchema>;
