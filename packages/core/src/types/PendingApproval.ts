import { z } from "zod";

/** A tool call waiting for the user to confirm it (oversight levels confirm and always_ask). */
export const PendingApprovalSchema = z.object({
  id: z.string(),
  callId: z.string(),
  toolId: z.string(),
  functionName: z.string(),
  argsJson: z.string(),
  sessionId: z.string(),
  uiRequestId: z.string(),
  documentId: z.string().nullable(),
  status: z.enum(["pending", "approved", "denied"]),
  createdAt: z.string(),
});

export type PendingApproval = z.infer<typeof PendingApprovalSchema>;
