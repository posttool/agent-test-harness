import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentReasoningLoop,
  DEFAULT_MODEL_POLICY,
  InMemoryStorage,
  ManualClock,
  ModelPolicyRunner,
  ScriptedProviderClient,
  SequentialIds,
  ToolExecutor,
  ToolRegistry,
  toolWiring,
  type CapabilitySpec,
  type ProviderRequest,
  type ScriptedReply,
  type Signal,
  type UiContext,
  type UiRequest,
} from "../src/index.ts";
import { VmSandbox } from "../src/node/index.ts";

const caps: CapabilitySpec[] = [
  { id: "tools.discover", title: "Discover", role: "loop", outputSchema: "ToolDiscoveryResult", whenToUse: "need a tool", activity: "Finding tools", instructions: "DISCOVER" },
  { id: "tools.use", title: "Use", role: "loop", outputSchema: "ToolInvocationPlan", whenToUse: "call a tool", activity: "Working", instructions: "USE" },
];
const route = { value: { action: "new", sessionId: null, title: "Groceries", rationale: "r" } };
const step = (capability: string) => ({ value: { action: "step", capability, instruction: `do ${capability}`, rationale: "r", summary: null } });
const end = (summary: string) => ({ value: { action: "end", capability: null, instruction: null, rationale: "r", summary } });
const schema = JSON.stringify({ type: "object", properties: { card: { type: "string" } }, required: ["card"], additionalProperties: false });
const discovery = {
  value: {
    strategy: "generate_code",
    toolId: null,
    searchQuery: null,
    rationale: "no grocery tool yet",
    proposal: {
      name: "Grocer",
      description: "Orders groceries",
      source: "generated_code",
      endpoint: null,
      code: "async function checkout(a){ return { paidWith: a.card }; }",
      functions: [{ name: "checkout", description: "Pay", paramsJsonSchema: schema, returnsJsonSchema: "{}", oversight: "confirm", longRunning: false }],
    },
  },
};

let script: Record<string, ScriptedReply[]>;
let ui: { request: UiRequest; context: UiContext }[];
let loop: AgentReasoningLoop;
let registry: ToolRegistry;
let executor: ToolExecutor;

const signal = (content: string, extra: Partial<Signal> = {}): Signal => ({
  id: `sig_${content}`,
  kind: "user_text",
  source: "home",
  occurredAt: "2026-09-30T18:00:00Z",
  content,
  data: {},
  sessionId: null,
  uiRequestId: null,
  subscriptionId: null,
  ...extra,
});

beforeEach(() => {
  const clock = new ManualClock(0);
  const ids = new SequentialIds();
  const storage = new InMemoryStorage();
  registry = new ToolRegistry(storage, clock, ids);
  executor = new ToolExecutor({ registry, storage, sandbox: new VmSandbox(), clock, ids });
  const claude = new ScriptedProviderClient("claude", clock);
  claude.handler = (req: ProviderRequest) => {
    const reply = script[req.schemaName]?.shift();
    if (!reply) throw new Error(`no ${req.schemaName} reply`);
    return reply;
  };
  script = {};
  ui = [];
  const wiring = toolWiring({ registry, executor });
  loop = new AgentReasoningLoop({
    runner: new ModelPolicyRunner({ clients: { claude }, policy: DEFAULT_MODEL_POLICY, clock }),
    capabilities: caps,
    prompts: { loop: "L", router: "R" },
    effects: wiring.effects,
    contextProviders: wiring.contextProviders,
    onResume: wiring.onResume,
    onUiRequest: (request, context) => ui.push({ request, context }),
    addressedSession: (s) => (s.subscriptionId === "sub_x" ? "session_1" : null),
    clock,
    ids,
  });
});

describe("tools in the loop", () => {
  it("discovers a tool, asks before a confirm-level call, and runs it once approved", async () => {
    script = {
      RouteDecision: [route],
      NextStepDecision: [step("tools.discover"), step("tools.use")],
      ToolDiscoveryResult: [discovery],
      ToolInvocationPlan: [{ value: { toolId: "tool_1", functionName: "checkout", argsJson: '{"card":"visa"}', argsFromMemory: [], documentId: null, rationale: "pay" } }],
    };
    const paused = await loop.handleSignal(signal("buy the groceries"));
    expect(paused.status).toBe("paused");
    expect((await registry.list()).map((t) => t.name)).toContain("Grocer");
    expect(ui[0]!.request).toMatchObject({ purpose: "disambiguation", blocking: true, question: "Allow Grocer to checkout?" });
    expect(ui[0]!.request.component.elements.map((e) => e.id)).toEqual(["what", "card", "approve", "deny"]);

    script.NextStepDecision = [end("paid")];
    const { context } = ui[0]!;
    const done = await loop.handleSignal(
      signal("Approve", { kind: "ui_feedback", sessionId: context.sessionId, uiRequestId: context.uiRequestId, data: { feedback: { context, action: "approve", values: {}, at: "t" } } }),
    );
    expect(done.status).toBe("ended");
    expect(done.context.some((b) => b.title?.startsWith("Approval granted") && b.content.includes('"paidWith":"visa"'))).toBe(true);
    expect((await executor.calls()).find((c) => c.functionName === "checkout")!.status).toBe("ok");
  });

  it("routes tool progress to the session that started the process, even after it ended", async () => {
    script = { RouteDecision: [route], NextStepDecision: [end("ordered; waiting for progress")] };
    const first = await loop.handleSignal(signal("order a ride"));
    expect(first).toMatchObject({ id: "session_1", status: "ended" });

    script.NextStepDecision = [end("driver is close; told the user")];
    const again = await loop.handleSignal(signal("Driver 2 minutes away", { kind: "tool_progress", source: "Rides", subscriptionId: "sub_x" }));
    expect(again).toMatchObject({ id: "session_1", status: "ended", summary: "driver is close; told the user" });
    expect(again.triggerIds).toHaveLength(2);
    expect(loop.traces.list({ triggerId: again.triggerIds[1]! }).map((t) => t.kind)).not.toContain("route");
  });
});
