import { z } from "zod";
import { SurfaceBriefEntrySchema } from "./SurfaceBriefEntry.ts";

/** LLM output: what the Device tool puts on each surface. */
export const SurfacePlanSchema = z.object({
  islandWords: z.string().describe("One or two words for the Dynamic Island, or an empty string when idle."),
  brief: z.array(SurfaceBriefEntrySchema).describe("The few most relevant items right now, most important first."),
  discover: z.array(SurfaceBriefEntrySchema).describe("Related topics the user did not ask for."),
  spaceDocumentIds: z.array(z.string()).describe("Document node ids to show as tabs in Spaces."),
  rationale: z.string(),
});

export type SurfacePlan = z.infer<typeof SurfacePlanSchema>;
