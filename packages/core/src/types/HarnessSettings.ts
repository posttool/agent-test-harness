import { z } from "zod";
import { ModelPolicySchema } from "./ModelPolicy.ts";

/** Settings the harness UI can change at runtime. */
export const HarnessSettingsSchema = z.object({
  policy: ModelPolicySchema,
  theme: z.enum(["light", "dark"]).default("dark"),
  signalWindowSeconds: z.number().default(600).describe("Virtual seconds of ambient events batched into one signal."),
  personaId: z.string().nullable().default(null),
});

export type HarnessSettings = z.infer<typeof HarnessSettingsSchema>;
