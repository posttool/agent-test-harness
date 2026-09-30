import { z } from "zod";

/** The fixed icon vocabulary for brief rows, so every skin can draw each one. */
export const BriefIconSchema = z.enum(["event", "message", "task", "travel", "place", "shopping", "school", "health", "money", "weather", "info", "alert"]);

export type BriefIcon = z.infer<typeof BriefIconSchema>;
