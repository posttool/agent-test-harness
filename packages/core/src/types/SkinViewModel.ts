import { z } from "zod";
import { SkinNeedStateSchema } from "./SkinNeedState.ts";
import { UiComponentSpecSchema } from "./UiComponentSpec.ts";

const BriefRow = z.object({
  id: z.string(),
  kind: z.enum(["item", "notice", "question"]),
  title: z.string(),
  line: z.string(),
  cta: z.string(),
  reason: z.string(),
  icon: z.string(),
  badge: z.string(),
  topicId: z.string().nullable(),
  documentId: z.string().nullable(),
  /** Set when tapping should open a question. */
  questionId: z.string().nullable(),
});

/**
 * Skin contract v1 (docs/SKINS_FROM_CLAUDE_DESIGN.md section 3): the only data a skin sees.
 * Scalars and lists of plain objects, so every field is a dotted path a template can bind.
 */
export const SkinViewModelSchema = z.object({
  contract: z.literal(1),
  now: z.object({ iso: z.string(), time: z.string(), date: z.string(), weekday: z.string() }),
  locked: z.boolean(),
  location: z.string().nullable(),
  theme: z.enum(["light", "dark"]),
  island: z.object({
    active: z.boolean(),
    words: z.string(),
    process: z.object({ label: z.string(), status: z.string(), detail: z.string(), progress: z.number().nullable(), eta: z.string() }).nullable(),
  }),
  brief: z.object({ headline: z.string(), summary: z.string(), updatedAt: z.string(), items: z.array(BriefRow) }),
  questions: z.array(z.object({ id: z.string(), title: z.string(), question: z.string(), component: UiComponentSpecSchema })),
  documents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      description: z.string(),
      sections: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string(), body: z.string(), items: z.array(z.string()) })),
      processes: z.array(z.object({ id: z.string(), label: z.string(), status: z.string(), detail: z.string() })),
      results: z.array(z.string()),
      followUps: z.array(z.string()),
      actions: z.array(z.object({ label: z.string() })),
    }),
  ),
  discover: z.array(BriefRow),
  today: z.array(z.object({ id: z.string(), time: z.string(), title: z.string(), detail: z.string(), kind: z.enum(["event", "penciled"]) })),
  waiting: z.array(z.object({ id: z.string(), who: z.string(), when: z.string(), text: z.string(), cta: z.string() })),
  apps: z.array(z.object({ id: z.string(), name: z.string(), icon: z.string() })),
  needs: z.record(z.string(), SkinNeedStateSchema),
  /** True while rendering sample data instead of live state. */
  sample: z.boolean(),
});

export type SkinViewModel = z.infer<typeof SkinViewModelSchema>;
export type SkinBriefRow = z.infer<typeof BriefRow>;
