import { z } from "zod";
import { UiSurfaceSchema } from "./UiSurface.ts";
import { UiComponentSpecSchema } from "./UiComponentSpec.ts";

/** LLM output: UI the agent wants to show, often to ask the user something. */
export const UiRequestSchema = z.object({
  purpose: z.enum(["disambiguation", "document_view", "brief_item", "notice"]),
  surface: UiSurfaceSchema,
  blocking: z.boolean().describe("True when the session must pause until the user answers."),
  question: z.string().nullable().describe("The one question, as the user reads it: one short sentence."),
  component: UiComponentSpecSchema,
  rationale: z.string().describe("Why this UI, for the trace only. The user never sees it."),
});

export type UiRequest = z.infer<typeof UiRequestSchema>;
