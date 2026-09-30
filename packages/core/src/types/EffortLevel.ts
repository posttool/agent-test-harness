import { z } from "zod";

/** Claude reasoning effort (`output_config.effort`). */
export const EffortLevelSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export type EffortLevel = z.infer<typeof EffortLevelSchema>;
