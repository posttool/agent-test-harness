import { z } from "zod";

/** The agent's own calendar. Tentative entries are penciled in until approved. */
export const CalendarEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  start: z.string(),
  end: z.string().nullable(),
  location: z.string().nullable(),
  status: z.enum(["penciled", "confirmed", "cancelled"]),
  source: z.string(),
  topicId: z.string().nullable(),
});

export type CalendarEntry = z.infer<typeof CalendarEntrySchema>;
