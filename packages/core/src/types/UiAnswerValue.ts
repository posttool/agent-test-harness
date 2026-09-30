import { z } from "zod";

/** LLM output part: one form value in a simulated user's answer. */
export const UiAnswerValueSchema = z.object({
  fieldId: z.string(),
  value: z.string(),
});

export type UiAnswerValue = z.infer<typeof UiAnswerValueSchema>;
