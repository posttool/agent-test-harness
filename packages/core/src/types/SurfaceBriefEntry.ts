import { z } from "zod";
import { BriefIconSchema } from "./BriefIcon.ts";

/**
 * LLM output part: one glanceable item on the Contextual Brief or Discover screen. Kept
 * flat on purpose: Claude's structured outputs allow at most 16 nullable parameters per schema.
 */
export const SurfaceBriefEntrySchema = z.object({
  topicId: z.string().nullable().describe("The topic this is about, if any."),
  documentId: z.string().nullable().describe("The document to open when tapped, if any."),
  title: z.string().describe("A few words."),
  line: z.string().describe("One short line with the key detail."),
  callToAction: z.string().describe("A short verb phrase, e.g. 'See list', 'Reply to Jane'."),
  reason: z.string().describe("One short sentence for the user about why it is here now."),
  icon: BriefIconSchema.describe("The icon that fits best."),
  badge: z.string().describe("A very short trailing value, e.g. 'in 49m', '14m', '2', or an empty string."),
});

export type SurfaceBriefEntry = z.infer<typeof SurfaceBriefEntrySchema>;
