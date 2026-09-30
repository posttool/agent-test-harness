import { z } from "zod";

/** LLM output: which tool function to call, with what arguments. */
export const ToolInvocationPlanSchema = z.object({
  toolId: z.string(),
  functionName: z.string(),
  argsJson: z.string().describe("Arguments as a JSON object string."),
  argsFromMemory: z.array(z.string()).describe("Memory node ids the arguments were filled from."),
  rationale: z.string(),
});

export type ToolInvocationPlan = z.infer<typeof ToolInvocationPlanSchema>;
