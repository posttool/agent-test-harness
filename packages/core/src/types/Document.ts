import { z } from "zod";
import { DocumentSectionSchema } from "./DocumentSection.ts";
import { ProcessStatusSchema } from "./ProcessStatus.ts";
import { SuggestedActionSchema } from "./SuggestedAction.ts";

/** A growing page that records a project's lifecycle. */
export const DocumentSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  title: z.string(),
  description: z.string(),
  sections: z.array(DocumentSectionSchema),
  processes: z.array(ProcessStatusSchema),
  results: z.array(z.string()),
  followUps: z.array(z.string()),
  suggestedActions: z.array(SuggestedActionSchema),
  revisionIds: z.array(z.string()),
  /** Documents are archived when their project is finished. */
  archivedAt: z.string().nullable(),
});

export type Document = z.infer<typeof DocumentSchema>;
