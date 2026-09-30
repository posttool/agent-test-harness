import { z } from "zod";

/** Everything a skin can do. The host checks each command and turns it into runtime messages. */
export const SkinCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unlock") }),
  z.object({ type: z.literal("lock") }),
  z.object({ type: z.literal("say"), text: z.string(), via: z.enum(["text", "voice"]) }),
  z.object({ type: z.literal("answer"), questionId: z.string(), action: z.string(), values: z.record(z.string(), z.string()), said: z.string() }),
  z.object({ type: z.literal("open"), itemId: z.string() }),
  z.object({ type: z.literal("act"), itemId: z.string() }),
  z.object({ type: z.literal("dismiss"), itemId: z.string() }),
  z.object({ type: z.literal("need"), needId: z.string() }),
]);

export type SkinCommand = z.infer<typeof SkinCommandSchema>;
