import { z } from "zod";
import { BriefIconSchema } from "./BriefIcon.ts";

/**
 * LLM output part: one glanceable item on the Contextual Brief or Discover screen. Kept
 * flat on purpose: Claude's structured outputs allow at most 16 nullable parameters per schema.
 */
export const SurfaceBriefEntrySchema = z.object({
  topicId: z.string().nullable().describe("The topic this is about, if any."),
  documentId: z.string().nullable().describe("The document to open when tapped, if any."),
  title: z.string().describe("Two to five words."),
  line: z.string().describe("The key detail, under ten words."),
  callToAction: z.string().describe("A short verb phrase, e.g. 'See list', 'Reply to Jane'."),
  reason: z.string().describe("Why it is here now, one short sentence for the user (under 12 words)."),
  icon: BriefIconSchema.describe("The icon that fits best."),
  badge: z.string().describe("A very short trailing value, e.g. 'in 49m', '14m', '2', or an empty string."),
});

export type SurfaceBriefEntry = z.infer<typeof SurfaceBriefEntrySchema>;
