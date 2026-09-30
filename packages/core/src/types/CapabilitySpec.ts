import { z } from "zod";
import { ModelRoleSchema } from "./ModelRole.ts";

/** A capability loaded from its Markdown file: front-matter plus instructions. */
export const CapabilitySpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  role: ModelRoleSchema,
  outputSchema: z.string(),
  whenToUse: z.string(),
  /** One or two words for the Dynamic Island while this capability runs. */
  activity: z.string().default("Thinking"),
  instructions: z.string(),
});

export type CapabilitySpec = z.infer<typeof CapabilitySpecSchema>;
