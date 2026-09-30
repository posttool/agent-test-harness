import { beforeEach, describe, expect, it } from "vitest";
import {
  AmbientEngine,
  AmbientFactory,
  DEFAULT_MODEL_POLICY,
  FallbackPersonaSource,
  HttpPersonaSource,
  InMemoryStorage,
  ModelPolicyRunner,
  ScriptedProviderClient,
  SequentialIds,
  SignalBridge,
  StaticPersonaSource,
  VirtualClock,
  personaBrief,
  personaDaySource,
  type AmbientEvent,
  type AmbientSource,
  type Signal,
} from "../src/index.ts";
import { loadAmbientTemplates, loadPersonaFixtures } from "../src/node/index.ts";

const START = Date.parse("2025-11-07T07:00:00Z");
const scripted = (name: string, offsets: number[], extra: Partial<AmbientSource> = {}): AmbientSource => ({
  id: name,
  kind: "sms",
  name,
  templateId: null,
  ratePerMinute: 0,
  speed: 1,
  enabled: true,
  startedAt: null,
  cursor: 0,
  lifecycle: "persistent",
  ownerSubscriptionId: null,
  definition: { events: offsets.map((o) => ({ offsetSeconds: o, kind: "sms", content: `${name}@${o}`, status: "info" })) },
  ...extra,
});

let clock: VirtualClock;
let engine: AmbientEngine;
let seen: AmbientEvent[];
beforeEach(() => {
  clock = new VirtualClock(START, 1);
  engine = new AmbientEngine({ storage: new InMemoryStorage(), clock, ids: new SequentialIds() });
  seen = [];
  engine.onEvent((e) => void seen.push(e));
});

describe("AmbientEngine", () => {
  it("emits scripted events as virtual time passes, remembering where it is", async () => {
    await engine.addSource(scripted("a", [0, 60, 120]));
    await engine.tick();
    expect(seen.map((e) => e.content)).toEqual(["a@0"]);
    clock.advanceReal(60_000);
    await engine.tick();
    await engine.tick();
    expect(seen.map((e) => e.content)).toEqual(["a@0", "a@60"]);
    expect((await engine.sources())[0]!.cursor).toBe(2);
    expect(seen[1]!.at).toBe("2025-11-07T07:01:00.000Z");
  });

  it("applies per-source speed and the global speed", async () => {
    await engine.addSource(scripted("fast", [0, 600], { speed: 10 }));
    await engine.addSource(scripted("slow", [0, 600]));
    clock.speed = 2;
    clock.advanceReal(30_000); // 60 virtual seconds
    await engine.tick();
    expect(seen.map((e) => e.content).sort()).toEqual(["fast@0", "fast@600", "slow@0"]);
  });

  it("pauses everything when globally off, and skips disabled sources", async () => {
    await engine.addSource(scripted("a", [0]));
    await engine.addSource(scripted("b", [0], { enabled: false }));
    engine.enabled = false;
    await engine.tick();
    expect(seen).toEqual([]);
    engine.enabled = true;
    await engine.tick();
    expect(seen.map((e) => e.sourceId)).toEqual(["a"]);
    await engine.updateSource("b", { enabled: true });
    await engine.tick();
    expect(seen.map((e) => e.sourceId)).toEqual(["a", "b"]);
  });

  it("asks for more events when a persistent generated source runs out", async () => {
    engine.setExtender(async () => [{ offsetSeconds: 30, kind: "sms", content: "more", status: "info" }]);
    await engine.addSource(scripted("gen", [0], { definition: { prompt: "texts", events: [{ offsetSeconds: 0, kind: "sms", content: "first", status: "info" }] } }));
    await engine.tick();
    await new Promise((r) => setTimeout(r, 0));
    clock.advanceReal(30_000);
    await engine.tick();
    expect(seen.map((e) => e.content)).toEqual(["first", "more"]);
  });

  it("keeps recent events and clears", async () => {
    await engine.addSource(scripted("a", [0]));
    await engine.tick();
    expect(engine.recentEvents()).toHaveLength(1);
    await engine.clear();
    expect(await engine.sources()).toEqual([]);
    expect(engine.recentEvents()).toEqual([]);
  });
});

describe("SignalBridge", () => {
  it("batches ambient events by a window of virtual time, and passes tool progress straight through", () => {
    const sent: Signal[] = [];
    const bridge = new SignalBridge({ clock, send: (s) => sent.push(s), windowSeconds: 300, ids: new SequentialIds() });
    const src = scripted("msgs", []);
    const ev = (content: string, at: number, kind: AmbientEvent["kind"] = "sms"): AmbientEvent => ({ id: content, sourceId: "msgs", kind, at: new Date(at).toISOString(), content, data: { status: "info" } });

    bridge.accept(ev("hi", START), src);
    bridge.accept(ev("lunch?", START + 60_000), src);
    expect(bridge.flush()).toBeNull();
    clock.set(START + 300_000);
    const batch = bridge.flush()!;
    expect(batch).toMatchObject({ kind: "ambient", source: "msgs", content: "[07:00] hi\n[07:01] lunch?" });

    bridge.accept({ ...ev("Driver is 2 min away", START, "tool_progress"), data: { status: "running" } }, { ...src, name: "Rides", ownerSubscriptionId: "sub_1" });
    expect(sent.at(-1)).toMatchObject({ kind: "tool_progress", subscriptionId: "sub_1", data: { status: "running" } });

    bridge.accept(ev("Arriving at the grocery store", START + 400_000, "location"), src);
    expect(bridge.location).toBe("Arriving at the grocery store");
    expect(bridge.flush(true)).toMatchObject({ kind: "location" });
  });
});

describe("AmbientFactory", () => {
  it("generates sources from templates (persona-grounded) and descriptions", async () => {
    const claude = new ScriptedProviderClient("claude");
    const script = { name: "Texts", kind: "sms", description: "texts", events: [{ offsetSeconds: 10, kind: "sms", content: "Chloe: cat cafe at 4?", status: "info" }] };
    claude.script("*", { value: script }, { value: script });
    const factory = new AmbientFactory(new ModelPolicyRunner({ clients: { claude }, policy: DEFAULT_MODEL_POLICY }), new SequentialIds());
    const [sms] = loadAmbientTemplates("samples/ambient").filter((t) => t.id === "sms");
    const source = await factory.fromTemplate(sms!, "name: Jamie Lee");
    expect(source).toMatchObject({ templateId: "sms", kind: "sms", lifecycle: "persistent" });
    expect(claude.calls[0]).toMatchObject({ schemaName: "AmbientScript", effort: "low" });
    expect(claude.calls[0]!.context.map((c) => c.title)).toEqual(["Stream to simulate", "Whose life this is"]);
    const vibe = await factory.fromDescription("a smart fridge that complains", null);
    expect(vibe.definition.prompt).toBe("a smart fridge that complains");
    expect(claude.calls[1]!.context).toHaveLength(1);
  });

  it("ships five templates", () => {
    expect(loadAmbientTemplates("samples/ambient").map((t) => t.id).sort()).toEqual(["drive_home_to_office", "email", "home_security", "location_changes", "sms"]);
  });
});

describe("persona sources", () => {
  const fixtures = loadPersonaFixtures("fixtures/personas");

  it("loads the exported persona fixtures", async () => {
    const source = new StaticPersonaSource(fixtures);
    const personas = await source.listPersonas();
    expect(personas.map((p) => p.name)).toContain("Jamie Lee");
    const jamie = personas.find((p) => p.name === "Jamie Lee")!;
    const [day] = await source.listDays(jamie.id);
    expect((await source.listObservations(jamie.id, day!.date)).length).toBeGreaterThan(100);
    expect(personaBrief(await source.getPersona(jamie.id))).toContain("Hong Kong");
  });

  it("validates the HTTP service and rejects the {} that listObservations1 returns today", async () => {
    const fake = (body: unknown) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
    await expect(new HttpPersonaSource("http://x/", fake([{ id: "p", name: "P" }])).listPersonas()).resolves.toMatchObject([{ id: "p", name: "P", city: null }]);
    await expect(new HttpPersonaSource("http://x", fake({})).listObservations("p", "2025-11-07")).rejects.toThrow();
  });

  it("falls back to fixtures when the service fails", async () => {
    const down = new HttpPersonaSource("http://127.0.0.1:1/");
    const source = new FallbackPersonaSource(down, new StaticPersonaSource(fixtures));
    expect((await source.listPersonas()).length).toBe(3);
    expect(source.lastUsed).toBe("persona fixtures");
  });

  it("turns a persona day into one scripted source starting at the first observation", async () => {
    const jamie = fixtures.personas.find((p) => p.name === "Jamie Lee")!;
    const date = fixtures.days[jamie.id]![0]!.date;
    const { source, startsAt } = personaDaySource(jamie, date, fixtures.observations[`${jamie.id}/${date}`]!, new SequentialIds());
    const events = source.definition.events as { offsetSeconds: number; content: string }[];
    expect(new Date(startsAt).toISOString()).toBe(`${date}T06:45:00.000Z`);
    expect(events[0]).toMatchObject({ offsetSeconds: 0, content: "phone audio: <gentle melody alarm>" });
    expect(events.map((e) => e.offsetSeconds)).toEqual([...events.map((e) => e.offsetSeconds)].sort((a, b) => a - b));
    expect(events.some((e) => e.content.includes("(WhatsApp · Maya Lee)"))).toBe(true);
  });
});
