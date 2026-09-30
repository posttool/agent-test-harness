import { z } from "zod";
import { ToolSourceSchema } from "./ToolSource.ts";
import { ToolFunctionSchema } from "./ToolFunction.ts";
import { ToolProvenanceSchema } from "./ToolProvenance.ts";

/** A tool: a named set of typed functions. */
export const ToolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  source: ToolSourceSchema,
  functions: z.array(ToolFunctionSchema),
  endpoint: z.string().nullable(),
  code: z.string().nullable(),
  provenance: ToolProvenanceSchema,
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
