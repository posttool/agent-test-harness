import { z } from "zod";

/** Kinds of trace entries. */
export const TraceKindSchema = z.enum([
  "signal",
  "route",
  "decision",
  "step_start",
  "step_result",
  "model_attempt",
  "model_rest",
  "session_paused",
  "session_resumed",
  "session_ended",
  "error",
]);

export type TraceKind = z.infer<typeof TraceKindSchema>;
