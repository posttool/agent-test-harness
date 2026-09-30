import { z } from "zod";

/** Live status of a running process inside a Document. */
export const ProcessStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  subscriptionId: z.string().nullable(),
  status: z.enum(["starting", "running", "snag", "complete", "failed", "cancelled"]),
  detail: z.string(),
  updatedAt: z.string(),
});

export type ProcessStatus = z.infer<typeof ProcessStatusSchema>;
