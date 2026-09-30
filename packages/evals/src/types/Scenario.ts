import { z } from "zod";
import { ScenarioStepSchema } from "./ScenarioStep.ts";

/** An eval scenario (samples/scenarios/*.json, PLAN.md section 10.5). */
export const ScenarioSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Who the simulated user is; the user simulator answers questions as them. */
  user: z.string(),
  start: z.string(),
  /** Tool suggestions (by name) installed before the scenario starts. */
  tools: z.array(z.string()).default([]),
  steps: z.array(ScenarioStepSchema),
  /** Keep the virtual clock running this many minutes after the last step (for long-running tools). */
  settleMinutes: z.number().default(0),
  /** Re-plan the phone's surfaces at the end, so the rubric can check the Contextual Brief. */
  refreshSurfaces: z.boolean().default(true),
  rubric: z.array(z.string()),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
