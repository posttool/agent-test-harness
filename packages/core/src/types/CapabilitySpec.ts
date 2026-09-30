import { z } from "zod";
import { ModelRoleSchema } from "./ModelRole.ts";

/** A capability loaded from its Markdown file: front-matter plus instructions. */
export const CapabilitySpecSchema = z.object({
  id: z.string(),
  title: z.string(),
  role: ModelRoleSchema,
  outputSchema: z.string(),
  whenToUse: z.string(),
  instructions: z.string(),
});

export type CapabilitySpec = z.infer<typeof CapabilitySpecSchema>;
