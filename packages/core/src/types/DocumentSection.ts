import { z } from "zod";

/** One section of a Document page. */
export const DocumentSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["text", "list", "progress", "actions", "links", "dates", "observations", "app"]),
  body: z.string(),
});

export type DocumentSection = z.infer<typeof DocumentSectionSchema>;
