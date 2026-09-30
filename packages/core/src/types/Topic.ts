import { z } from "zod";
import { LifecycleStageSchema } from "./LifecycleStage.ts";
import { TopicMetaSchema } from "./TopicMeta.ts";

/** A node of the topic index (e.g. Academics > Math test prep). */
export const TopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  parentId: z.string().nullable(),
  stage: LifecycleStageSchema,
  meta: TopicMetaSchema,
  documentId: z.string().nullable(),
});

export type Topic = z.infer<typeof TopicSchema>;
