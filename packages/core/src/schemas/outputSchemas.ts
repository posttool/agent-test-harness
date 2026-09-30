import type { z } from "zod";
import { MemoryMutationPlanSchema } from "../types/MemoryMutationPlan.ts";
import { MemoryReadResultSchema } from "../types/MemoryReadResult.ts";
import { NextStepDecisionSchema } from "../types/NextStepDecision.ts";
import { RouteDecisionSchema } from "../types/RouteDecision.ts";
import { ToolDiscoveryResultSchema } from "../types/ToolDiscoveryResult.ts";
import { ToolInvocationPlanSchema } from "../types/ToolInvocationPlan.ts";
import { UiRequestSchema } from "../types/UiRequest.ts";
import { AmbientScriptSchema } from "../types/AmbientScript.ts";
import { SurfacePlanSchema } from "../types/SurfacePlan.ts";
import { JudgeVerdictSchema } from "../types/JudgeVerdict.ts";
import { UiAnswerSchema } from "../types/UiAnswer.ts";
import { LlmToolResultSchema } from "../types/LlmToolResult.ts";

/**
 * Every schema a model is asked to produce. Each one must pass the provider parity
 * check (see model/jsonSchema.ts): both Claude and Gemini must accept it.
 */
export const OUTPUT_SCHEMAS = {
  NextStepDecision: NextStepDecisionSchema,
  RouteDecision: RouteDecisionSchema,
  MemoryMutationPlan: MemoryMutationPlanSchema,
  MemoryReadResult: MemoryReadResultSchema,
  ToolDiscoveryResult: ToolDiscoveryResultSchema,
  ToolInvocationPlan: ToolInvocationPlanSchema,
  UiRequest: UiRequestSchema,
  AmbientScript: AmbientScriptSchema,
  SurfacePlan: SurfacePlanSchema,
  JudgeVerdict: JudgeVerdictSchema,
  UiAnswer: UiAnswerSchema,
  LlmToolResult: LlmToolResultSchema,
} as const satisfies Record<string, z.ZodType>;

export type OutputSchemaName = keyof typeof OUTPUT_SCHEMAS;

export function isOutputSchemaName(name: string): name is OutputSchemaName {
  return Object.hasOwn(OUTPUT_SCHEMAS, name);
}
