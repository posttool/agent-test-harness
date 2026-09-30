import { z } from "zod";

/** A piece of working context handed to the model. */
export const ContextBlockSchema = z.object({
  kind: z.enum(["signal", "memory", "step", "feedback", "instruction", "note", "error"]),
  title: z.string().nullable().default(null),
  content: z.string(),
});

export type ContextBlock = z.infer<typeof ContextBlockSchema>;
