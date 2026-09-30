import { z } from "zod";
import { SkinNeedSchema } from "./SkinNeed.ts";

/** skins/<slug>/skin.json */
export const SkinManifestSchema = z.object({
  id: z.string(),
  name: z.string(),
  contract: z.literal(1),
  needs: z.array(SkinNeedSchema).default([]),
  /** "builtin": a skin written in code (skins/default). "dc": a Claude Design canvas played by @harness/dc-runtime. */
  renderer: z.enum(["builtin", "dc"]).default("builtin"),
  /** The Claude Design canvas it was installed from. */
  source: z.string().nullable().default(null),
  /** "incomplete" until every screen the harness needs exists in the design. */
  status: z.enum(["complete", "incomplete"]).default("complete"),
  /** Artboard file for each harness screen (lock, home, brief, spaces, discover, document…). */
  screens: z.record(z.string(), z.string()).default({}),
  missingScreens: z.array(z.string()).default([]),
  /** Artboard file → harness screen, set by a person. Wins over the analysis. */
  screenOverrides: z.record(z.string(), z.string()).default({}),
  /** When the design was last installed, and a hash of each design file, so re-installs can tell what changed. */
  installed: z.object({ at: z.string(), files: z.record(z.string(), z.string()) }).nullable().default(null),
});

export type SkinManifest = z.infer<typeof SkinManifestSchema>;
