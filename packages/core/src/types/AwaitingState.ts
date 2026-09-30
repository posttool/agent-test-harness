import { z } from "zod";

/** What a paused session is waiting for. */
export const AwaitingStateSchema = z.object({
  kind: z.literal("ui"),
  uiRequestId: z.string(),
  stepId: z.string(),
});

export type AwaitingState = z.infer<typeof AwaitingStateSchema>;
