import { z } from "zod";

/** LLM output part: one leaf element. The vocabulary is flat on purpose (no recursion). */
export const UiElementSchema = z.object({
  kind: z.enum(["text", "list", "form_field", "choice", "button", "progress", "map", "qr", "link", "image"]),
  id: z.string(),
  label: z.string().nullable(),
  text: z.string().nullable(),
  items: z.array(z.string()).describe("List entries or choice options; empty otherwise."),
  value: z.string().nullable(),
  url: z.string().nullable(),
  progress: z.number().nullable().describe("0 to 1 for progress elements."),
  fieldType: z.enum(["text", "number", "date", "boolean"]).nullable(),
});

export type UiElement = z.infer<typeof UiElementSchema>;
