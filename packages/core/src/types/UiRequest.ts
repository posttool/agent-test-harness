import { z } from "zod";
import { UiSurfaceSchema } from "./UiSurface.ts";
import { UiComponentSpecSchema } from "./UiComponentSpec.ts";

/** LLM output: UI the agent wants to show, often to ask the user something. */
export const UiRequestSchema = z.object({
  purpose: z.enum(["disambiguation", "document_view", "brief_item", "notice"]),
  surface: UiSurfaceSchema,
  blocking: z.boolean().describe("True when the session must pause until the user answers."),
  question: z.string().nullable(),
  component: UiComponentSpecSchema,
  rationale: z.string(),
});

export type UiRequest = z.infer<typeof UiRequestSchema>;
