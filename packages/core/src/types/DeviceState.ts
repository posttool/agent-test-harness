import { z } from "zod";
import { IslandStateSchema } from "./IslandState.ts";
import { SurfaceItemSchema } from "./SurfaceItem.ts";

/** Everything the Experience shows. The skin renders this and nothing else. */
export const DeviceStateSchema = z.object({
  locked: z.boolean(),
  island: IslandStateSchema,
  brief: z.array(SurfaceItemSchema),
  spaces: z.array(SurfaceItemSchema),
  discover: z.array(SurfaceItemSchema),
  notices: z.array(SurfaceItemSchema),
  virtualTime: z.string(),
  location: z.string().nullable(),
});

export type DeviceState = z.infer<typeof DeviceStateSchema>;
