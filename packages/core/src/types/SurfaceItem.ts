import { z } from "zod";
import { UiComponentSpecSchema } from "./UiComponentSpec.ts";
import { UiContextSchema } from "./UiContext.ts";

/** One component placed on a surface. */
export const SurfaceItemSchema = z.object({
  id: z.string(),
  component: UiComponentSpecSchema,
  context: UiContextSchema.nullable(),
  topicId: z.string().nullable(),
  documentId: z.string().nullable(),
  reason: z.string().nullable(),
  updatedAt: z.string(),
});

export type SurfaceItem = z.infer<typeof SurfaceItemSchema>;
