import { z } from "zod";

/** One call of a tool function, shown in the Tools panel. */
export const ToolCallRecordSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  functionName: z.string(),
  args: z.record(z.string(), z.unknown()),
  status: z.enum(["awaiting_approval", "running", "ok", "error", "denied"]),
  result: z.unknown(),
  error: z.string().nullable(),
  sessionId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  at: z.string(),
});

export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;
