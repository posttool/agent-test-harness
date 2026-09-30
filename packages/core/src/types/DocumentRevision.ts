import { z } from "zod";

/** One recorded action in a Document's history. */
export const DocumentRevisionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  at: z.string(),
  actor: z.enum(["agent", "user", "tool"]),
  action: z.string(),
  sessionId: z.string().nullable(),
});

export type DocumentRevision = z.infer<typeof DocumentRevisionSchema>;
