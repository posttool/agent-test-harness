import { z } from "zod";
import { MilestoneSchema } from "./Milestone.ts";

/** Progress toward completing a topic. */
export const ProgressSchema = z.object({
  milestones: z.array(MilestoneSchema),
  next: z.string().nullable(),
  stalled: z.boolean(),
});

export type Progress = z.infer<typeof ProgressSchema>;
