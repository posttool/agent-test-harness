import { z } from "zod";

/** Kinds of ambient data source. */
export const AmbientKindSchema = z.enum(["email", "sms", "location", "home_security", "drive", "vision", "calendar", "tool_progress", "custom"]);

export type AmbientKind = z.infer<typeof AmbientKindSchema>;
