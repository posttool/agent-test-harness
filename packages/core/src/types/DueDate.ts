import { z } from "zod";

/** A date a topic is bound to. */
export const DueDateSchema = z.object({
  kind: z.enum(["exact", "relative", "conditional"]),
  value: z.string().describe("ISO date for exact; words for relative or conditional."),
  label: z.string(),
  source: z.enum(["signal", "user", "agent"]),
});

export type DueDate = z.infer<typeof DueDateSchema>;
