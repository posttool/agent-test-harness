import { z } from "zod";
import { SessionStatusSchema } from "./SessionStatus.ts";
import { ContextBlockSchema } from "./ContextBlock.ts";
import { AwaitingStateSchema } from "./AwaitingState.ts";

/** One chain of thought started by a trigger. */
export const ReasoningSessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: SessionStatusSchema,
  triggerIds: z.array(z.string()),
  stepIds: z.array(z.string()),
  context: z.array(ContextBlockSchema),
  awaiting: AwaitingStateSchema.nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ReasoningSession = z.infer<typeof ReasoningSessionSchema>;
