import { z } from "zod";
import { UiAnswerValueSchema } from "./UiAnswerValue.ts";

/** LLM output: how a simulated user answers a piece of UI (evals and persona runs). */
export const UiAnswerSchema = z.object({
  action: z.string().describe("The id of the button or choice the user picks, or 'dismiss'."),
  values: z.array(UiAnswerValueSchema),
  said: z.string().describe("What the user would say, in their words."),
});

export type UiAnswer = z.infer<typeof UiAnswerSchema>;
