import { z } from "zod";

/** Lifecycle of a reasoning session. */
export const SessionStatusSchema = z.enum(["active", "paused", "ended", "failed"]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;
