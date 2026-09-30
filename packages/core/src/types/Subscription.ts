import { z } from "zod";

/** A long-running tool call's progress stream. */
export const SubscriptionSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  functionName: z.string(),
  sessionId: z.string(),
  documentId: z.string().nullable(),
  ambientSourceId: z.string(),
  status: z.enum(["active", "completed", "failed", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;
