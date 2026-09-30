import { z } from "zod";

/** How much user oversight a tool function needs. */
export const OversightLevelSchema = z.enum(["auto_from_memory", "auto_notify", "confirm", "always_ask"]);

export type OversightLevel = z.infer<typeof OversightLevelSchema>;
