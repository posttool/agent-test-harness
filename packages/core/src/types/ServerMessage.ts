import { z } from "zod";
import { HarnessSnapshotSchema } from "./HarnessSnapshot.ts";
import { TraceEntrySchema } from "./TraceEntry.ts";

/** What the runtime pushes to every connected client. */
export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), snapshot: HarnessSnapshotSchema }),
  z.object({ type: z.literal("traces"), entries: z.array(TraceEntrySchema), reset: z.boolean() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
