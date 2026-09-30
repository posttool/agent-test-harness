import { z } from "zod";
import { SignalKindSchema } from "./SignalKind.ts";

/** Anything that starts or continues reasoning. */
export const SignalSchema = z.object({
  id: z.string(),
  kind: SignalKindSchema,
  source: z.string(),
  occurredAt: z.string(),
  content: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  /** Set when the signal is explicitly addressed to a session (UI feedback). */
  sessionId: z.string().nullable().default(null),
  uiRequestId: z.string().nullable().default(null),
  subscriptionId: z.string().nullable().default(null),
});

export type Signal = z.infer<typeof SignalSchema>;
