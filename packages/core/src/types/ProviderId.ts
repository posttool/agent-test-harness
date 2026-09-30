import { z } from "zod";

/** A model provider. */
export const ProviderIdSchema = z.enum(["claude", "gemini"]);

export type ProviderId = z.infer<typeof ProviderIdSchema>;
