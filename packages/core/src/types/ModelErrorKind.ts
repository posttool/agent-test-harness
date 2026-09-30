import { z } from "zod";

/** Normalized failure classes shared by every provider adapter. */
export const ModelErrorKindSchema = z.enum([
  "rate_limit",
  "overloaded",
  "server",
  "timeout",
  "network",
  "schema_invalid",
  "max_tokens",
  "refusal",
  "bad_request",
  "not_found",
  "auth",
  "unknown",
]);

export type ModelErrorKind = z.infer<typeof ModelErrorKindSchema>;
