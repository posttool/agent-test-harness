import { z } from "zod";

/** Where a piece of UI came from, so feedback can return to it. */
export const UiContextSchema = z.object({
  sessionId: z.string(),
  uiRequestId: z.string(),
  stepId: z.string(),
  documentId: z.string().nullable(),
  topicId: z.string().nullable(),
});

export type UiContext = z.infer<typeof UiContextSchema>;
