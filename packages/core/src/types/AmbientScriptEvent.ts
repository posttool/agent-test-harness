import { z } from "zod";
import { AmbientKindSchema } from "./AmbientKind.ts";

/** LLM output part: one scripted event of an ambient source. */
export const AmbientScriptEventSchema = z.object({
  offsetSeconds: z.number().describe("Seconds after the source starts."),
  kind: AmbientKindSchema,
  content: z.string().describe("What arrives, written as the device would see it (sender, app, text)."),
  status: z.enum(["info", "running", "snag", "complete", "failed"]).describe("For tool progress; use info otherwise."),
});

export type AmbientScriptEvent = z.infer<typeof AmbientScriptEventSchema>;
