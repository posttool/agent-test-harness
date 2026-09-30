import { z } from "zod";
import { IslandStateSchema } from "./IslandState.ts";
import { SkinNeedStateSchema } from "./SkinNeedState.ts";
import { SurfaceItemSchema } from "./SurfaceItem.ts";
import { WaitingItemSchema } from "./WaitingItem.ts";

/** Everything the Experience shows. The skin renders this and nothing else. */
export const DeviceStateSchema = z.object({
  locked: z.boolean(),
  island: IslandStateSchema,
  /** The day in a few words, and a line or two, from the last surface plan. */
  headline: z.string().default(""),
  summary: z.string().default(""),
  briefUpdatedAt: z.string().nullable().default(null),
  brief: z.array(SurfaceItemSchema),
  waiting: z.array(WaitingItemSchema).default([]),
  /** Data skins asked the agent for, keyed by need id. */
  needs: z.record(z.string(), SkinNeedStateSchema).default({}),
  spaces: z.array(SurfaceItemSchema),
  discover: z.array(SurfaceItemSchema),
  notices: z.array(SurfaceItemSchema),
  virtualTime: z.string(),
  location: z.string().nullable(),
});

export type DeviceState = z.infer<typeof DeviceStateSchema>;
