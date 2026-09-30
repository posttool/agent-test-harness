import { describe, expect, it } from "vitest";
import { AgentReasoningLoop, ClaudeClient, DEFAULT_MODEL_POLICY, ModelPolicyRunner, type UiRequest } from "@harness/core";
import { loadCapabilities, loadPrompt } from "../src/index.ts";

// Live end-to-end loop on Claude with the real capability files and prompts.
// Memory and tool effects arrive in M3/M4, so this checks routing, step choice, and the
// ask-first rule, not what gets stored.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)("reasoning loop, live on Claude", () => {
  it("handles a signal end to end with real capabilities", async () => {
    const ui: UiRequest[] = [];
    const loop = new AgentReasoningLoop({
      runner: new ModelPolicyRunner({ clients: { claude: new ClaudeClient() }, policy: DEFAULT_MODEL_POLICY }),
      capabilities: await loadCapabilities(),
      prompts: { loop: await loadPrompt("loop"), router: await loadPrompt("router") },
      onUiRequest: (request) => ui.push(request),
      maxStepsPerSession: 6,
    });
    const session = await loop.handleSignal({
      id: "s1",
      kind: "user_text",
      source: "home input bar",
      occurredAt: "2026-09-30T18:00:00Z",
      content: "Buy my sister a sweater for her birthday next week.",
      data: {},
      sessionId: null,
      uiRequestId: null,
      subscriptionId: null,
    });

    const steps = loop.sessions.stepsOf(session.id).map((s) => `${s.capability} [${s.status}]: ${s.instruction}`);
    console.log("session:", session.title, "|", session.status, "|", session.summary ?? session.error);
    console.log(steps.join("\n"));
    for (const r of ui) console.log("ui:", r.purpose, r.blocking, r.question);

    expect(["ended", "paused"]).toContain(session.status);
    expect(steps.length).toBeGreaterThan(0);
    // No stored preferences, and choosing a gift involves spending money, so the agent
    // should end up asking the user something.
    expect(ui.some((r) => r.purpose === "disambiguation")).toBe(true);
  });
});
