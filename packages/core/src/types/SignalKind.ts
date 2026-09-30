import { z } from "zod";

/** Where a signal came from. */
export const SignalKindSchema = z.enum([
  "user_text",
  "user_speech",
  "message",
  "location",
  "vision",
  "ambient",
  "tool_progress",
  "ui_feedback",
  "schedule",
  "skin_need",
]);

export type SignalKind = z.infer<typeof SignalKindSchema>;
