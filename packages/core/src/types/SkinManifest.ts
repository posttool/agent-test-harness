import { z } from "zod";
import { SkinNeedSchema } from "./SkinNeed.ts";

/** skins/<slug>/skin.json */
export const SkinManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  contract: z.literal(1),
  needs: z.array(SkinNeedSchema).default([]),
});

export type SkinManifest = z.infer<typeof SkinManifestSchema>;
