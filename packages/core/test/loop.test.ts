import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentReasoningLoop,
  DEFAULT_MODEL_POLICY,
  ManualClock,
  ModelPolicyRunner,
  ScriptedProviderClient,
  SequentialIds,
  scriptedError,
  type CapabilitySpec,
  type ProviderRequest,
  type ScriptedReply,
  type Signal,
  type UiContext,
  type UiRequest,
} from "../src/index.ts";

// Scripted replies keyed by output schema, consumed in order.
type Script = Partial<Record<string, ScriptedReply[]>>;

const caps: CapabilitySpec[] = [
  { id: "memory.write", title: "Write", role: "memoryMerge", outputSchema: "MemoryMutationPlan", whenToUse: "new info", instructions: "WRITE" },
  { id: "memory.read", title: "Read", role: "loop", outputSchema: "MemoryReadResult", whenToUse: "need facts", instructions: "READ" },
  { id: "ui.generate", title: "UI", role: "device", outputSchema: "UiRequest", whenToUse: "ask the user", instructions: "UI" },
];

const route = (action: "new" | "continue", sessionId: string | null = null, title: string | null = "Dinner plans") => ({
  value: { action, sessionId, title: action === "new" ? title : null, rationale: "r" },
});
const step = (capability: string, instruction = `do ${capability}`) => ({
  value: { action: "step", capability, instruction, rationale: "because", summary: null },
});
const end = (summary = "handled") => ({ value: { action: "end", capability: null, instruction: null, rationale: "done", summary } });
const plan = { value: { rationale: "r", operations: [], needsUserConfirmation: false, question: null } };
const read = { value: { relevantNodeIds: [], facts: [], gaps: ["favorite color"], summary: "no color preference" } };
const ask = (blocking = true) => ({
  value: {
    purpose: "disambiguation",
    surface: "intent_space",
    blocking,
    question: "Red or blue?",
    component: { kind: "choice_group", id: "c1", title: "Pick a color", elements: [], primaryActionLabel: null },
    rationale: "no stored preference",
  },
});

let clock: ManualClock;
let claude: ScriptedProviderClient;
let script: Script;
let uiRequests: { request: UiRequest; context: UiContext }[];

function makeLoop(options: Partial<ConstructorParameters<typeof AgentReasoningLoop>[0]> = {}) {
  const ids = new SequentialIds();
  const runner = new ModelPolicyRunner({ clients: { claude }, policy: DEFAULT_MODEL_POLICY, clock });
  return new AgentReasoningLoop({
    runner,
    capabilities: caps,
    prompts: { loop: "LOOP PROMPT", router: "ROUTER PROMPT" },
    clock,
    ids,
    onUiRequest: (request, context) => uiRequests.push({ request, context }),
    ...options,
  });
}

let signalCount = 0;
const signal = (content: string, overrides: Partial<Signal> = {}): Signal => ({
  id: `sig_${++signalCount}`,
  kind: "user_text",
  source: "home input bar",
  occurredAt: "2026-09-30T18:00:00.000Z",
  content,
  data: {},
  sessionId: null,
  uiRequestId: null,
  subscriptionId: null,
  ...overrides,
});

beforeEach(() => {
  clock = new ManualClock(Date.parse("2026-09-30T18:00:00Z"));
  claude = new ScriptedProviderClient("claude", clock);
  script = {};
  uiRequests = [];
  claude.handler = (request: ProviderRequest) => {
    const reply = script[request.schemaName]?.shift();
    if (!reply) throw new Error(`test script has no ${request.schemaName} reply left`);
    return reply;
  };
});

describe("AgentReasoningLoop", () => {
  it("routes a signal, runs capabilities chosen by the model, and ends", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("memory.write"), end("Saved Jane's pick")], MemoryMutationPlan: [plan] };
    const loop = makeLoop();
    const session = await loop.handleSignal(signal("Jane wants to go to Zuni"));

    expect(session).toMatchObject({ status: "ended", summary: "Saved Jane's pick", title: "Dinner plans" });
    expect(loop.sessions.stepsOf(session.id).map((s) => [s.capability, s.status])).toEqual([["memory.write", "ok"]]);
    const triggerId = session.triggerIds[0]!;
    expect(loop.traces.list({ triggerId }).map((t) => t.kind)).toEqual([
      "signal",
      "route",
      "decision",
      "step_start",
      "step_result",
      "decision",
      "session_ended",
    ]);
  });

  it("uses the stable loop prompt plus the capability catalog, and each capability's own instructions", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("memory.write", "store it"), end()], MemoryMutationPlan: [plan] };
    await makeLoop().handleSignal(signal("x"));
    const decisionCall = claude.calls.find((c) => c.schemaName === "NextStepDecision")!;
    expect(decisionCall.system).toContain("LOOP PROMPT");
    expect(decisionCall.system).toContain("- memory.write (Write): new info");
    const capCall = claude.calls.find((c) => c.schemaName === "MemoryMutationPlan")!;
    expect(capCall.system).toBe("WRITE");
    expect(capCall.context.at(-1)).toMatchObject({ kind: "instruction", content: "store it" });
    expect(capCall.effort).toBe("medium"); // memoryMerge role
    expect(claude.calls.find((c) => c.schemaName === "RouteDecision")!.effort).toBe("low");
  });

  it("feeds each step's output into the next decision", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("memory.read"), end()], MemoryReadResult: [read] };
    await makeLoop().handleSignal(signal("buy a sweater"));
    const second = claude.calls.filter((c) => c.schemaName === "NextStepDecision")[1]!;
    expect(second.context.at(-1)).toMatchObject({ kind: "step", title: "memory.read: do memory.read" });
    expect(second.context.at(-1)!.content).toContain("no color preference");
  });

  it("pauses on a blocking question and resumes the same session with the user's answer", async () => {
    script = { RouteDecision: [route("new", null, "Sweater")], NextStepDecision: [step("ui.generate", "ask color")], UiRequest: [ask()] };
    const loop = makeLoop();
    const paused = await loop.handleSignal(signal("buy me a sweater"));

    expect(paused.status).toBe("paused");
    expect(uiRequests).toHaveLength(1);
    const { context } = uiRequests[0]!;
    expect(context).toMatchObject({ sessionId: paused.id, uiRequestId: paused.awaiting!.uiRequestId, stepId: paused.awaiting!.stepId });
    expect(loop.sessions.requireStep(context.stepId).status).toBe("awaiting_ui");

    script.NextStepDecision = [end("Ordered the blue one")];
    const routerCallsBefore = claude.calls.filter((c) => c.schemaName === "RouteDecision").length;
    const resumed = await loop.handleSignal(
      signal("Blue", {
        kind: "ui_feedback",
        sessionId: context.sessionId,
        uiRequestId: context.uiRequestId,
        data: { feedback: { context, action: "blue", values: {}, at: "2026-09-30T18:01:00Z" } },
      }),
    );

    expect(resumed).toMatchObject({ id: paused.id, status: "ended", summary: "Ordered the blue one", awaiting: null });
    expect(claude.calls.filter((c) => c.schemaName === "RouteDecision")).toHaveLength(routerCallsBefore); // no router call
    expect(loop.sessions.requireStep(context.stepId).status).toBe("ok");
    const lastDecision = claude.calls.filter((c) => c.schemaName === "NextStepDecision").at(-1)!;
    expect(lastDecision.context.at(-1)).toMatchObject({ kind: "feedback" });
    expect(lastDecision.context.at(-1)!.content).toContain('"action":"blue"');
    expect(loop.traces.list({ sessionId: paused.id }).map((t) => t.kind)).toContain("session_resumed");
  });

  it("does not pause for a non-blocking UI request", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("ui.generate"), end()], UiRequest: [ask(false)] };
    const session = await makeLoop().handleSignal(signal("x"));
    expect(session.status).toBe("ended");
    expect(uiRequests).toHaveLength(1);
  });

  it("keeps a paused session paused when an unrelated update is routed to it", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("ui.generate")], UiRequest: [ask()] };
    const loop = makeLoop();
    const paused = await loop.handleSignal(signal("buy a sweater"));
    script.RouteDecision = [route("continue", paused.id)];
    const after = await loop.handleSignal(signal("Mom says she likes green", { kind: "message", source: "sms" }));
    expect(after).toMatchObject({ id: paused.id, status: "paused" });
    expect(after.context.at(-1)!.content).toBe("Mom says she likes green");
  });

  it("continues an existing session when the router says so", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [end("first")] };
    const loop = makeLoop();
    const first = await loop.handleSignal(signal("plan dinner"));
    loop.sessions.update(first.id, { status: "active" }); // keep it open for this test
    script = { RouteDecision: [route("continue", first.id)], NextStepDecision: [end("second")] };
    const second = await loop.handleSignal(signal("Jane can do Tuesday"));
    expect(second.id).toBe(first.id);
    expect(second.triggerIds).toHaveLength(2);
    const routerContext = claude.calls.filter((c) => c.schemaName === "RouteDecision")[1]!.context;
    expect(routerContext[1]!.content).toContain(first.id);
  });

  it("starts a new session when the router names a session that is not open", async () => {
    script = { RouteDecision: [route("continue", "session_404")], NextStepDecision: [end()] };
    const loop = makeLoop();
    const session = await loop.handleSignal(signal("hi"));
    expect(session.status).toBe("ended");
    expect(loop.traces.list({ kind: "error" })[0]!.data.message).toContain("not open");
  });

  it("asks again after an invalid decision, and fails after too many", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("teleport"), step("memory.write"), end()], MemoryMutationPlan: [plan] };
    const ok = await makeLoop().handleSignal(signal("x"));
    expect(ok.status).toBe("ended");
    const retry = claude.calls.filter((c) => c.schemaName === "NextStepDecision")[1]!;
    expect(retry.context.at(-1)).toMatchObject({ kind: "error" });
    expect(retry.context.at(-1)!.content).toContain('"teleport" is not an available capability');

    script = { RouteDecision: [route("new")], NextStepDecision: [step("teleport"), step("teleport"), step("teleport")] };
    const bad = await makeLoop().handleSignal(signal("y"));
    expect(bad).toMatchObject({ status: "failed" });
    expect(bad.error).toContain("Too many invalid decisions");
  });

  it("stops a runaway session at the step limit", async () => {
    script = {
      RouteDecision: [route("new")],
      NextStepDecision: Array.from({ length: 5 }, () => step("memory.write")),
      MemoryMutationPlan: Array.from({ length: 5 }, () => plan),
    };
    const session = await makeLoop({ maxStepsPerSession: 3 }).handleSignal(signal("x"));
    expect(session).toMatchObject({ status: "failed", error: "Stopped after 3 steps" });
  });

  it("fails the session with the attempts when every model fails", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("memory.write")], MemoryMutationPlan: [scriptedError("refusal"), scriptedError("refusal")] };
    const loop = makeLoop();
    const session = await loop.handleSignal(signal("x"));
    expect(session.status).toBe("failed");
    expect(loop.sessions.stepsOf(session.id)[0]!.status).toBe("failed");
    const error = loop.traces.list({ kind: "error" })[0]!;
    expect(error.data.attempts).toHaveLength(4); // 2 Claude refusals + 2 Gemini skipped (no client)
  });

  it("uses custom effects and context providers", async () => {
    script = { RouteDecision: [route("new")], NextStepDecision: [step("memory.write"), end()], MemoryMutationPlan: [plan] };
    const applied: unknown[] = [];
    const loop = makeLoop({
      effects: { "memory.write": (output) => (applied.push(output), { note: "wrote 0 nodes" }) },
      contextProviders: { "memory.write": () => [{ kind: "memory", title: "Graph", content: "(empty graph)" }] },
    });
    const session = await loop.handleSignal(signal("x"));
    expect(applied).toEqual([plan.value]);
    expect(claude.calls.find((c) => c.schemaName === "MemoryMutationPlan")!.context.some((b) => b.content === "(empty graph)")).toBe(true);
    expect(session.context.find((b) => b.kind === "step")!.content).toContain("wrote 0 nodes");
  });

  it("runs many sessions at once", async () => {
    claude.handler = (request) => {
      if (request.schemaName === "RouteDecision") return { value: { action: "new", sessionId: null, title: "t", rationale: "r" }, latencyMs: 5 };
      return { ...end(`done: ${request.context[0]!.content}`), latencyMs: 10 };
    };
    const loop = makeLoop();
    const sessions = await Promise.all(["a", "b", "c"].map((c) => loop.handleSignal(signal(c))));
    expect(new Set(sessions.map((s) => s.id)).size).toBe(3);
    expect(sessions.map((s) => s.summary).sort()).toEqual(["done: a", "done: b", "done: c"]);
  });

  it("rejects capabilities that name an unknown output schema", () => {
    expect(() => makeLoop({ capabilities: [{ ...caps[0]!, outputSchema: "Nope" }] })).toThrow("unknown output schema");
  });
});
