import { z } from "zod";

/** One milestone inside a Progress record. */
export const MilestoneSchema = z.object({
  title: z.string(),
  status: z.enum(["not_started", "in_progress", "done", "blocked"]),
});

export type Milestone = z.infer<typeof MilestoneSchema>;
