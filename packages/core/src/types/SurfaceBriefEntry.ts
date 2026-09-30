import { z } from "zod";
import { UiComponentSpecSchema } from "./UiComponentSpec.ts";

/** LLM output part: one item on the Contextual Brief or Discover screen. */
export const SurfaceBriefEntrySchema = z.object({
  topicId: z.string().nullable(),
  reason: z.string().describe("Why this matters now (time, place, urgency, action needed)."),
  component: UiComponentSpecSchema,
});

export type SurfaceBriefEntry = z.infer<typeof SurfaceBriefEntrySchema>;
