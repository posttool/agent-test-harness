import { z } from "zod";
import { AmbientKindSchema } from "./AmbientKind.ts";
import { AmbientScriptEventSchema } from "./AmbientScriptEvent.ts";

/** LLM output: a simulated stream of events (templates, vibe-coded sources, tool progress). */
export const AmbientScriptSchema = z.object({
  name: z.string(),
  kind: AmbientKindSchema,
  description: z.string(),
  events: z.array(AmbientScriptEventSchema),
});

export type AmbientScript = z.infer<typeof AmbientScriptSchema>;
