import { z } from "zod";

/** Where a tool came from. */
export const ToolSourceSchema = z.enum(["builtin", "web_api", "mcp", "llm", "generated_code"]);

export type ToolSource = z.infer<typeof ToolSourceSchema>;
