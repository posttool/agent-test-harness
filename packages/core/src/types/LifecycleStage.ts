import { z } from "zod";

/** Where a topic is in its lifecycle. */
export const LifecycleStageSchema = z.enum(["seeded", "active", "waiting", "completing", "done", "archived"]);

export type LifecycleStage = z.infer<typeof LifecycleStageSchema>;
