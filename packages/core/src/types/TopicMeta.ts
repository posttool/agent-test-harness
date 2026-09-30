import { z } from "zod";
import { TriggerRuleSchema } from "./TriggerRule.ts";
import { TriggerOverrideSchema } from "./TriggerOverride.ts";
import { NoveltySummarySchema } from "./NoveltySummary.ts";
import { ProgressSchema } from "./Progress.ts";
import { DueDateSchema } from "./DueDate.ts";

/** Index metadata attached to every topic (PLAN.md section 5.3). */
export const TopicMetaSchema = z.object({
  triggers: z.array(TriggerRuleSchema),
  userOverrides: z.array(TriggerOverrideSchema),
  summary: z.string(),
  newSinceLastSeen: NoveltySummarySchema.nullable(),
  progress: ProgressSchema.nullable(),
  dueDates: z.array(DueDateSchema),
  lastUpdatedAt: z.string(),
  lastSeenAt: z.string().nullable(),
});

export type TopicMeta = z.infer<typeof TopicMetaSchema>;
