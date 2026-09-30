import { describe, expect, it } from "vitest";
import {
  ClaudeClient,
  DEFAULT_MODEL_POLICY,
  GeminiClient,
  ModelPolicyRunner,
  ModelPolicySchema,
  NextStepDecisionSchema,
  OUTPUT_SCHEMAS,
  toProviderJsonSchema,
} from "../src/index.ts";

// Live smoke tests (PLAN.md M2): real calls with real output schemas, one describe per
// provider. Run with `npm run test:live`. Each block skips itself when its key is not set.

const system = "You are the reasoning loop of a personal agent. Choose the next step.";
const context = [
  { kind: "signal" as const, title: "user_text", content: "Remind me to buy oat milk when I'm at the grocery store." },
  {
    kind: "instruction" as const,
    title: "Capabilities",
    content: "memory.write: store new information about the user's world.\nui.generate: ask the user something.",
  },
];
const exampleSystem = (name: string) =>
  `Produce a plausible example ${name} for a personal agent helping a college student plan a birthday party.`;
const schemaNames = Object.keys(OUTPUT_SCHEMAS) as (keyof typeof OUTPUT_SCHEMAS)[];

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("Claude live", () => {
  const client = new ClaudeClient();

  it("claude-opus-5-5 returns a valid NextStepDecision", async () => {
    const response = await client.generate({
      model: "claude-opus-5-5",
      system,
      context,
      schemaName: "NextStepDecision",
      jsonSchema: toProviderJsonSchema(NextStepDecisionSchema),
      effort: "low",
      maxOutputTokens: 4_000,
      timeoutMs: 90_000,
      serverFallback: true,
    });
    const decision = NextStepDecisionSchema.parse(JSON.parse(response.text));
    expect(["step", "end"]).toContain(decision.action);
    console.log("claude:", response.servedBy, JSON.stringify(decision), JSON.stringify(response.usage));
  });

  it.each(schemaNames)("accepts the %s output schema", async (name) => {
    const schema = OUTPUT_SCHEMAS[name];
    const response = await client.generate({
      model: "claude-opus-5-5",
      system: exampleSystem(name),
      context,
      schemaName: name,
      jsonSchema: toProviderJsonSchema(schema),
      effort: "low",
      maxOutputTokens: 8_000,
      timeoutMs: 110_000,
      serverFallback: true,
    });
    expect(schema.safeParse(JSON.parse(response.text)).success).toBe(true);
    console.log("claude schema ok:", name, JSON.stringify(response.usage));
  });
});

// Gemini goes through the resting runner with a Gemini-only chain: 503 "high demand" is common.
const geminiOnly = ModelPolicySchema.parse({
  ...DEFAULT_MODEL_POLICY,
  primary: { provider: "gemini", model: "gemini-3.8-flash" },
  fallbacks: [{ provider: "gemini", model: "gemini-3.7-flash" }],
  resting: { ...DEFAULT_MODEL_POLICY.resting, stepBudgetMs: 110_000 },
});

describe.skipIf(!process.env.GEMINI_API_KEY)("Gemini live (through the resting runner)", () => {
  const runner = new ModelPolicyRunner({
    clients: { gemini: new GeminiClient() },
    policy: geminiOnly,
    onAttempt: (a) => console.log("gemini attempt:", a.model, a.attempt, a.outcome, a.errorKind ?? "", `${a.latencyMs}ms`),
  });

  it.each(schemaNames)("accepts the %s output schema", async (name) => {
    const schema = OUTPUT_SCHEMAS[name];
    const result = await runner.run({ role: "loop", schemaName: name, schema: schema as never, system: exampleSystem(name), context });
    expect(schema.safeParse(result.value).success).toBe(true);
    console.log("gemini schema ok:", name, "via", result.model);
  });
});
