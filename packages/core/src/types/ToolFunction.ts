import { z } from "zod";
import { OversightLevelSchema } from "./OversightLevel.ts";

/** One typed function of a tool. */
export const ToolFunctionSchema = z.object({
  name: z.string(),
  description: z.string(),
  params: z.record(z.string(), z.unknown()).describe("JSON Schema for the arguments."),
  returns: z.record(z.string(), z.unknown()).describe("JSON Schema for the result."),
  oversight: OversightLevelSchema,
  longRunning: z.boolean(),
});

export type ToolFunction = z.infer<typeof ToolFunctionSchema>;
