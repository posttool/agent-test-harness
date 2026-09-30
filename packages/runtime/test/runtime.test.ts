import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { buildSkinView, ScriptedProviderClient, SequentialIds, skinCommandToMessages, type ProviderRequest, type ScriptedReply, type SkinManifest } from "@harness/core";
import { createNodeRuntime, type NodeRuntimeOptions } from "../src/node.ts";
import type { HarnessRuntime } from "../src/HarnessRuntime.ts";

const ROOT = process.cwd();
let script: Record<string, ScriptedReply[]>;
let claude: ScriptedProviderClient;

const reply = (value: unknown): ScriptedReply => ({ value });
const route = (title = "Groceries") => reply({ action: "new", sessionId: null, title, rationale: "r" });
const step = (capability: string, instruction = `do ${capability}`) => reply({ action: "step", capability, instruction, rationale: "r", summary: null });
const end = (summary = "done") => reply({ action: "end", capability: null, instruction: null, rationale: "r", summary });
const op = (o: Record<string, unknown>) => ({ nodeId: null, ref: null, type: null, title: null, summary: null, attributesJson: null, edgeType: null, from: null, to: null, reason: "r", ...o });
const plan = (...operations: unknown[]) => reply({ rationale: "r", operations, needsUserConfirmation: false, question: null });

async function runtime(extra: Partial<NodeRuntimeOptions> = {}): Promise<HarnessRuntime> {
  return createNodeRuntime({
    root: ROOT,
    env: {},
    clients: { claude },
    overrides: { ids: new SequentialIds(), start: Date.parse("2026-09-30T08:00:00Z"), autoRefreshSurfaces: false },
    ...extra,
  });
}

beforeEach(() => {
  script = {};
  claude = new ScriptedProviderClient("claude");
  claude.handler = (req: ProviderRequest) => {
    const next = script[req.schemaName]?.shift();
    if (!next) throw new Error(`no scripted ${req.schemaName}`);
    return next;
  };
});

describe("HarnessRuntime", () => {
  it("starts blank: no memory, traces, custom tools or ambient streams", async () => {
    const snap = await (await runtime()).snapshot();
    expect(snap.memory.nodes).toEqual([]);
    expect(snap.sessions).toEqual([]);
    expect(snap.tools.definitions.map((t) => t.id)).toEqual(["web", "device"]);
    expect(snap.ambient).toMatchObject({ enabled: true, sources: [] });
    expect(snap.persona.personas.map((p) => p.name)).toContain("Jamie Lee");
    expect(snap.templates).toHaveLength(5);
    expect(snap.tools.suggestions.map((s) => s.name)).toContain("Grocery list");
  });

  it("turns a user message into memory, with memory context for the capability", async () => {
    const rt = await runtime();
    script = {
      RouteDecision: [route()],
      NextStepDecision: [step("memory.write"), end("Saved oat milk")],
      MemoryMutationPlan: [plan(op({ op: "create_node", type: "topic", title: "Grocery list", attributesJson: '{"items":["oat milk"]}' }))],
    };
    await rt.handle({ type: "user_text", text: "add oat milk to my grocery list" });
    await rt.idle();
    const snap = await rt.snapshot();
    expect(snap.memory.topics.map((t) => t.title)).toEqual(["Grocery list"]);
    expect(snap.sessions[0]).toMatchObject({ status: "ended", summary: "Saved oat milk" });
    expect(snap.device.island).toEqual({ active: false, words: null });
    const decision = claude.calls.find((c) => c.schemaName === "NextStepDecision")!;
    expect(decision.context.at(-1)).toMatchObject({ title: "Tools you can use (via tools.use)" });
    expect(decision.context.at(-1)!.content).toContain("- Web [web]: search, fetch");
    const writeCall = claude.calls.find((c) => c.schemaName === "MemoryMutationPlan")!;
    expect(writeCall.context.map((b) => b.title)).toEqual(expect.arrayContaining(["Memory graph", "Now"]));
  });

  it("clears memory, tools, streams, traces and the device, but keeps settings", async () => {
    const rt = await runtime();
    await rt.handle({ type: "tool_add_suggestion", name: "Grocery list" });
    await rt.handle({ type: "settings", theme: "light", signalWindowSeconds: 120 });
    script = { RouteDecision: [route()], NextStepDecision: [end()] };
    await rt.sendUserText("hi");
    await rt.handle({ type: "clear" });
    const snap = await rt.snapshot();
    expect(snap.tools.definitions.map((t) => t.id)).toEqual(["web", "device"]);
    expect(snap.sessions).toEqual([]);
    expect(rt.traces.list()).toEqual([]);
    expect(snap.settings).toMatchObject({ theme: "light", signalWindowSeconds: 120 });
  });

  it("walks through a persona's day: virtual clock, batched ambient signals, routing", async () => {
    const rt = await runtime();
    const jamie = (await rt.snapshot()).persona.personas.find((p) => p.name === "Jamie Lee")!;
    script = { RouteDecision: Array.from({ length: 10 }, () => route("Morning")), NextStepDecision: Array.from({ length: 10 }, () => end("noted")) };
    await rt.handle({ type: "persona_start", personaId: jamie.id });
    let snap = await rt.snapshot();
    expect(snap.persona.active).toMatchObject({ name: "Jamie Lee", date: "2025-11-07" });
    expect(new Date(snap.ambient.virtualNow).toISOString()).toBe("2025-11-07T06:45:00.000Z");
    expect(snap.ambient.speed).toBe(60);
    expect(snap.ambient.sources).toHaveLength(1);

    await rt.tick(10_000); // 10 virtual minutes
    await rt.tick(1_000);
    await rt.idle();
    snap = await rt.snapshot();
    expect(snap.ambient.recentEvents.length).toBeGreaterThan(3);
    const signalContent = String((rt.traces.list({ kind: "signal" })[0]!.data.signal as { content: string }).content);
    expect(signalContent).toContain("[06:45] phone audio: <gentle melody alarm>");
    expect(snap.sessions.length).toBeGreaterThanOrEqual(1);

    await rt.handle({ type: "clear" });
    expect((await rt.snapshot()).persona.active).toBeNull();
  });

  it("runs a long-running tool: approval, subscription, progress back to its session", async () => {
    const rt = await runtime();
    await rt.handle({ type: "tool_add_suggestion", name: "Ride hailing (simulated)" });
    const rides = (await rt.snapshot()).tools.definitions.find((t) => t.name.startsWith("Ride"))!;
    script = {
      RouteDecision: [route("Ride to work")],
      NextStepDecision: [step("tools.use")],
      ToolInvocationPlan: [reply({ toolId: rides.id, functionName: "order_ride", argsJson: '{"pickup":"home","destination":"work"}', argsFromMemory: [], documentId: null, rationale: "r" })],
    };
    const paused = (await rt.sendUserText("get me a ride to work"))!;
    expect(paused.status).toBe("paused");
    const ask = (await rt.snapshot()).device.spaces[0]!;
    expect(ask.component.title).toBe("Ride hailing (simulated): order_ride");

    script.AmbientScript = [
      reply({
        name: "Ride",
        kind: "tool_progress",
        description: "ride",
        events: [
          { offsetSeconds: 30, kind: "tool_progress", content: "Driver Ana is 2 minutes away", status: "running" },
          { offsetSeconds: 600, kind: "tool_progress", content: "Arrived at work", status: "complete" },
        ],
      }),
    ];
    script.NextStepDecision = [end("ride ordered"), end("driver close"), end("arrived")];
    await rt.sendFeedback({ context: ask.context!, action: "approve", values: {}, at: "t" });
    let snap = await rt.snapshot();
    expect(snap.tools.subscriptions[0]).toMatchObject({ status: "active", sessionId: paused.id });
    expect(snap.ambient.sources.map((s) => s.kind)).toEqual(["tool_progress"]);
    expect(snap.device.spaces).toEqual([]);

    await rt.tick(30_000);
    await rt.idle();
    await rt.tick(600_000);
    await rt.idle();
    snap = await rt.snapshot();
    expect(snap.tools.subscriptions[0]!.status).toBe("completed");
    expect(snap.ambient.sources).toEqual([]);
    const session = snap.sessions.find((s) => s.id === paused.id)!;
    expect(session).toMatchObject({ status: "ended", summary: "arrived" });
    expect(session.triggerIds).toHaveLength(4);
  });

  it("persists memory and settings to a file and loads them on restart", async () => {
    const dataFile = join(mkdtempSync(join(tmpdir(), "harness-")), "data.json");
    const rt = await runtime({ dataFile });
    script = {
      RouteDecision: [route()],
      NextStepDecision: [step("memory.write"), end()],
      MemoryMutationPlan: [plan(op({ op: "create_node", type: "personal_preference", title: "Loves sushi" }))],
    };
    await rt.sendUserText("I love sushi");
    await rt.handle({ type: "settings", theme: "light" });
    await new Promise((r) => setTimeout(r, 400));
    const again = await runtime({ dataFile });
    const snap = await again.snapshot();
    expect(snap.memory.nodes.map((n) => n.title)).toEqual(["Loves sushi"]);
    expect(snap.settings.theme).toBe("light");
  });

  it("tells the agent when the user swipes a topic off the Brief", async () => {
    const rt = await runtime();
    script = {
      SurfacePlan: [reply({ islandWords: "", headline: "", summary: "", brief: [{ topicId: "node_9", documentId: null, title: "Academics", line: "Test Friday", callToAction: "Study", reason: "Study now", icon: "school", badge: "" }], discover: [], waiting: [], spaceDocumentIds: [], rationale: "r" })],
      RouteDecision: [route("Brief swipe")],
      NextStepDecision: [end("noted the dismissal")],
    };
    await rt.handle({ type: "refresh_surfaces" });
    const item = (await rt.snapshot()).device.brief[0]!;
    await rt.handle({ type: "dismiss", itemId: item.id });
    await rt.idle();
    const snap = await rt.snapshot();
    expect(snap.device.brief).toEqual([]);
    const signal = rt.traces.list({ kind: "signal" })[0]!.data.signal as { source: string; content: string };
    expect(signal).toMatchObject({ source: "brief swipe" });
    expect(signal.content).toContain('swiped away "Academics" (topic node_9)');
  });

  it("fills a skin need through the agent and a device tool call", async () => {
    const rt = await runtime();
    const need = { id: "weather", ask: "Local weather now and today.", fields: ["now", "summary"], refreshMinutes: 60 };
    script = {
      RouteDecision: [route("Weather for the skin")],
      NextStepDecision: [step("tools.use"), end("filled the weather")],
      ToolInvocationPlan: [reply({ toolId: "device", functionName: "fulfill_need", argsJson: JSON.stringify({ needId: "weather", values: { now: "14°C", summary: "Rain from 6pm" }, summary: "Rain from 6pm" }), argsFromMemory: [], documentId: null, rationale: "r" })],
    };
    await rt.handle({ type: "skin_need", need });
    await rt.idle();
    const snap = await rt.snapshot();
    expect(snap.device.needs.weather).toMatchObject({ status: "ready", values: { now: "14°C", summary: "Rain from 6pm" } });
    expect(buildSkinView(snap).needs.weather!.values.now).toBe("14°C");
    const signal = claude.calls.find((c) => c.schemaName === "RouteDecision")!;
    expect(JSON.stringify(signal.context)).toContain('device.fulfill_need with needId \\"weather\\"');
    // Fresh answers are not asked for again.
    expect(await rt.askNeed(need)).toBeNull();
  });

  it("marks a need failed when the agent ends without answering", async () => {
    const rt = await runtime();
    script = { RouteDecision: [route("Weather")], NextStepDecision: [end("no weather tool")] };
    await rt.askNeed({ id: "weather", ask: "weather", fields: ["now"], refreshMinutes: 60 });
    expect((await rt.snapshot()).device.needs.weather?.status).toBe("failed");
  });

  it("maps skin commands to runtime messages and ignores unknown ids", async () => {
    const rt = await runtime();
    script = {
      SurfacePlan: [reply({ islandWords: "", headline: "Busy day", summary: "Test at 2", brief: [{ topicId: "node_9", documentId: "node_10", title: "Chemistry", line: "Test at 2pm", callToAction: "Study", reason: "Soon", icon: "school", badge: "in 4h" }], discover: [], waiting: [{ topicId: null, who: "Maya", when: "8:12", text: "Dinner Friday?", callToAction: "Reply" }], spaceDocumentIds: [], rationale: "r" })],
    };
    await rt.handle({ type: "refresh_surfaces" });
    const snap = await rt.snapshot();
    const view = buildSkinView(snap);
    expect(view.brief).toMatchObject({ headline: "Busy day", summary: "Test at 2" });
    expect(view.brief.items[0]).toMatchObject({ title: "Chemistry", line: "Test at 2pm", icon: "school", badge: "in 4h", kind: "item", questionId: null });
    const manifest: SkinManifest = { id: "t", name: "t", contract: 1, needs: [{ id: "weather", ask: "w", fields: ["now"], refreshMinutes: 60 }] };
    const row = view.brief.items[0]!;
    expect(skinCommandToMessages({ type: "open", itemId: row.id }, snap, manifest)).toEqual([
      { type: "device", action: "unlock" },
      { type: "seen", topicId: "node_9" },
      { type: "open_document", documentId: "node_10" },
    ]);
    expect(skinCommandToMessages({ type: "act", itemId: view.waiting[0]!.id }, snap, manifest)[0]).toMatchObject({ type: "user_text", source: "skin action" });
    expect(skinCommandToMessages({ type: "say", text: "hi", via: "voice" }, snap, manifest)).toEqual([{ type: "user_text", text: "hi", source: "voice" }]);
    expect(skinCommandToMessages({ type: "need", needId: "weather" }, snap, manifest)).toEqual([{ type: "skin_need", need: manifest.needs[0] }]);
    expect(skinCommandToMessages({ type: "need", needId: "stocks" }, snap, manifest)).toEqual([]);
    expect(skinCommandToMessages({ type: "dismiss", itemId: "nope" }, snap, manifest)).toEqual([]);
    expect(skinCommandToMessages({ type: "answer", questionId: "nope", action: "a", values: {}, said: "" }, snap, manifest)).toEqual([]);
    expect(skinCommandToMessages({ type: "teleport" }, snap, manifest)).toEqual([]);
  });

  it("rejects malformed commands", async () => {
    const rt = await runtime();
    await expect(rt.handle({ type: "teleport" })).rejects.toThrow();
  });
});
