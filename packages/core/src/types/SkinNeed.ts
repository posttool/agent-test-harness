import { z } from "zod";

/**
 * Data a skin shows that nothing in memory holds, like the weather. The skin declares it in
 * skin.json and asks for it; the agent fills it with its own tools (device.fulfill_need).
 */
export const SkinNeedSchema = z.object({
  id: z.string(),
  ask: z.string(),
  fields: z.array(z.string()),
  refreshMinutes: z.number().default(60),
});

export type SkinNeed = z.infer<typeof SkinNeedSchema>;
