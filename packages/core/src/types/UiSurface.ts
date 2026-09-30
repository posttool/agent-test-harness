import { z } from "zod";

/** A surface of the Experience. */
export const UiSurfaceSchema = z.enum(["dynamic_island", "contextual_brief", "intent_space", "discover", "home", "lock"]);

export type UiSurface = z.infer<typeof UiSurfaceSchema>;
