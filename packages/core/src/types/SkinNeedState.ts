import { z } from "zod";

/** Where a skin need stands, as the skin sees it under `needs.<id>`. */
export const SkinNeedStateSchema = z.object({
  status: z.enum(["asked", "ready", "failed"]),
  fields: z.array(z.string()),
  /** Virtual time of the last ask or answer. */
  updatedAt: z.string(),
  summary: z.string(),
  values: z.record(z.string(), z.string()),
});

export type SkinNeedState = z.infer<typeof SkinNeedStateSchema>;
