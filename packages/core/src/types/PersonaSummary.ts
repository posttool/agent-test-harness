import { z } from "zod";

/** A persona as `listPersona1` returns it. */
export const PersonaSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  occupation: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  age: z.union([z.number(), z.string()]).nullable().default(null),
  image: z.string().nullable().default(null),
  hobbies: z.array(z.string()).nullable().default(null),
  goals_this_week: z.array(z.string()).nullable().default(null),
  family: z.unknown().optional(),
  apps: z.unknown().optional(),
});

export type PersonaSummary = z.infer<typeof PersonaSummarySchema>;
