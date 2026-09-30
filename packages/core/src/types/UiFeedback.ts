import { z } from "zod";
import { UiContextSchema } from "./UiContext.ts";

/** What the user did with a piece of UI. */
export const UiFeedbackSchema = z.object({
  context: UiContextSchema,
  action: z.string().describe("The button or choice id the user picked, or 'dismiss'."),
  values: z.record(z.string(), z.string()),
  at: z.string(),
});

export type UiFeedback = z.infer<typeof UiFeedbackSchema>;
