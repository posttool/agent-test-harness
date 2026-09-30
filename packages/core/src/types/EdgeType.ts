import { z } from "zod";

/** Memory edge type (open-ended). */
export const EdgeTypeSchema = z.string().describe("A memory edge type. Core types are in CORE_EDGE_TYPES; others are SchemaExtensions.");

export type EdgeType = z.infer<typeof EdgeTypeSchema>;

export const CORE_EDGE_TYPES = [
  "relates_to",
  "executing_for",
  "part_of",
  "supersedes",
  "mentions",
  "located_at",
  "scheduled_for",
  "depends_on",
  "conflicts_with",
] as const;
