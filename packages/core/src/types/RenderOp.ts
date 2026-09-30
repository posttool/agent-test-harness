import { z } from "zod";
import { UiSurfaceSchema } from "./UiSurface.ts";
import { UiComponentSpecSchema } from "./UiComponentSpec.ts";
import { UiContextSchema } from "./UiContext.ts";

/** An instruction from the Device tool to a skin. */
export const RenderOpSchema = z.object({
  surface: UiSurfaceSchema,
  op: z.enum(["set", "patch", "remove"]),
  component: UiComponentSpecSchema.nullable(),
  context: UiContextSchema,
});

export type RenderOp = z.infer<typeof RenderOpSchema>;
