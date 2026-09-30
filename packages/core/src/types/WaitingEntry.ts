import { z } from "zod";

/** LLM output part: something waiting on the user (an unanswered message or ask). */
export const WaitingEntrySchema = z.object({
  topicId: z.string().nullable().describe("The topic this is about, if any."),
  who: z.string().describe("Who is waiting, e.g. 'Maya'."),
  when: z.string().describe("When they asked, short, e.g. '8:12' or 'yesterday'."),
  text: z.string().describe("What they are waiting for, one short line."),
  callToAction: z.string().describe("A short verb phrase, e.g. 'Reply'."),
});

export type WaitingEntry = z.infer<typeof WaitingEntrySchema>;
