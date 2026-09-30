import { z } from "zod";
import { UiElementSchema } from "./UiElement.ts";

/** LLM output part: a component made of elements, rendered by the skin. */
export const UiComponentSpecSchema = z.object({
  kind: z.enum(["card", "form", "choice_group", "document_view", "brief_item", "notice"]),
  id: z.string(),
  title: z.string().nullable(),
  elements: z.array(UiElementSchema),
  primaryActionLabel: z.string().nullable(),
});

export type UiComponentSpec = z.infer<typeof UiComponentSpecSchema>;
