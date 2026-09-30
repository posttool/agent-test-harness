import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_MODEL_POLICY,
  ManualClock,
  ModelChainError,
  ModelPolicyRunner,
  ModelPolicySchema,
  RestRegistry,
  ScriptedProviderClient,
  scriptedError,
  type ModelAttempt,
  type ModelPolicy,
  type StructuredCall,
} from "../src/index.ts";

const Answer = z.object({ answer: z.string() });
const ok = (answer = "yes") => ({ value: { answer } });

const call = (overrides: Partial<StructuredCall<z.infer<typeof Answer>>> = {}): StructuredCall<z.infer<typeof Answer>> => ({
  role: "loop",
  schemaName: "Answer",
  schema: Answer,
  system: "You answer.",
  context: [{ kind: "note", title: null, content: "Question?" }],
  ...overrides,
});

let clock: ManualClock;
let claude: ScriptedProviderClient;
let gemini: ScriptedProviderClient;
let attempts: ModelAttempt[];

function runner(policy: ModelPolicy = DEFAULT_MODEL_POLICY, rests?: RestRegistry, random = () => 0.5) {
  return new ModelPolicyRunner({
    clients: { claude, gemini },
    policy,
    clock,
    random,
    ...(rests ? { rests } : {}),
    onAttempt: (a) => attempts.push(a),
  });
}

beforeEach(() => {
  clock = new ManualClock(1_000_000);
  claude = new ScriptedProviderClient("claude", clock);
  gemini = new ScriptedProviderClient("gemini", clock);
  attempts = [];
});

describe("default policy", () => {
  it("uses Claude Opus 5.5 first, then Opus 5, then Gemini", () => {
    expect(runner().chainFor("loop").map((r) => r.model)).toEqual([
      "claude-opus-5-5",
      "claude-opus-5",
      "gemini-3.8-flash",
      "gemini-3.7-flash",
    ]);
  });

  it("sends the role's effort to Claude and server fallback on", async () => {
    claude.script("claude-opus-5-5", ok());
    await runner().run(call({ role: "router" }));
    expect(claude.calls[0]).toMatchObject({ effort: "low", serverFallback: true, model: "claude-opus-5-5" });
    expect(claude.calls[0]!.jsonSchema).toMatchObject({ type: "object", additionalProperties: false });
  });

  it("sends no effort to Gemini", async () => {
    claude.script("*", scriptedError("refusal"), scriptedError("refusal"));
    gemini.script("gemini-3.8-flash", ok());
    await runner().run(call());
    expect(gemini.calls[0]!.effort).toBeNull();
  });

  it("applies role overrides", () => {
    const policy = ModelPolicySchema.parse({
      ...DEFAULT_MODEL_POLICY,
      roles: { router: { primary: { provider: "gemini", model: "gemini-3.8-flash" } } },
    });
    expect(runner(policy).chainFor("router")[0]!.model).toBe("gemini-3.8-flash");
    expect(runner(policy).chainFor("loop")[0]!.model).toBe("claude-opus-5-5");
  });
});

describe("retries on the same model", () => {
  it("backs off with full jitter, doubling the ceiling each time", async () => {
    claude.script("claude-opus-5-5", scriptedError("overloaded"), scriptedError("rate_limit"), scriptedError("server"), ok());
    const result = await runner(DEFAULT_MODEL_POLICY, undefined, () => 0.5).run(call());
    expect(result.model).toBe("claude-opus-5-5");
    // ceilings 1000, 2000, 4000 at random 0.5
    expect(clock.sleeps).toEqual([500, 1000, 2000]);
  });

  it("caps the backoff at maxDelayMs", async () => {
    const policy = ModelPolicySchema.parse({ ...DEFAULT_MODEL_POLICY, resting: { maxAttempts: 8, stepBudgetMs: 10_000_000 } });
    claude.script("claude-opus-5-5", ...Array.from({ length: 7 }, () => scriptedError("server")), ok());
    await runner(policy, undefined, () => 0.999).run(call());
    expect(Math.max(...clock.sleeps)).toBeLessThanOrEqual(30_000);
    expect(clock.sleeps.at(-1)).toBe(29_970);
  });

  it("honors retry-after over the computed delay", async () => {
    claude.script("claude-opus-5-5", scriptedError("rate_limit", 7_000), ok());
    await runner().run(call());
    expect(clock.sleeps).toEqual([7_000]);
  });

  it("gives up on a model after maxAttempts transient failures and falls back", async () => {
    claude.script("claude-opus-5-5", ...Array.from({ length: 4 }, () => scriptedError("overloaded")));
    claude.script("claude-opus-5", ok("from opus 5"));
    const result = await runner().run(call());
    expect(result.value.answer).toBe("from opus 5");
    expect(attempts.filter((a) => a.model === "claude-opus-5-5")).toHaveLength(4);
    expect(clock.sleeps).toHaveLength(3);
  });
});

describe("non-transient failures", () => {
  it("retries once with the validation error when output fails the schema", async () => {
    claude.script("claude-opus-5-5", { value: { wrong: 1 } }, ok("fixed"));
    const result = await runner().run(call());
    expect(result.value.answer).toBe("fixed");
    expect(clock.sleeps).toEqual([]);
    const retryContext = claude.calls[1]!.context.at(-1)!;
    expect(retryContext.kind).toBe("error");
    expect(retryContext.content).toContain("answer");
  });

  it("moves on after the schema retry also fails", async () => {
    claude.script("claude-opus-5-5", { text: "not json" }, { value: {} });
    claude.script("claude-opus-5", ok("next"));
    expect((await runner().run(call())).model).toBe("claude-opus-5");
  });

  it("goes straight to the next model on a refusal", async () => {
    claude.script("claude-opus-5-5", scriptedError("refusal"));
    claude.script("claude-opus-5", ok());
    await runner().run(call());
    expect(clock.sleeps).toEqual([]);
    expect(attempts.map((a) => [a.model, a.errorKind])).toEqual([
      ["claude-opus-5-5", "refusal"],
      ["claude-opus-5", null],
    ]);
  });

  it.each(["bad_request", "not_found"] as const)("moves on without retrying on %s", async (kind) => {
    claude.script("claude-opus-5-5", scriptedError(kind));
    claude.script("claude-opus-5", ok());
    await runner().run(call());
    expect(attempts).toHaveLength(2);
  });

  it("skips every model from a provider after an auth error, for the rest of the session", async () => {
    claude.script("claude-opus-5-5", scriptedError("auth"));
    gemini.script("gemini-3.8-flash", ok(), ok());
    const r = runner();
    await r.run(call());
    expect(r.disabled.has("claude")).toBe(true);
    expect(attempts.find((a) => a.model === "claude-opus-5")?.outcome).toBe("skipped_auth");
    attempts = [];
    await r.run(call());
    expect(claude.calls).toHaveLength(1);
    expect(attempts.slice(0, 2).map((a) => a.outcome)).toEqual(["skipped_auth", "skipped_auth"]);
  });

  it("skips a provider with no client configured", async () => {
    const r = new ModelPolicyRunner({ clients: { gemini }, policy: DEFAULT_MODEL_POLICY, clock });
    gemini.script("gemini-3.8-flash", ok());
    expect((await r.run(call())).provider).toBe("gemini");
  });

  it("throws ModelChainError with every attempt when the whole chain fails", async () => {
    claude.script("*", scriptedError("refusal"), scriptedError("refusal"));
    gemini.script("*", scriptedError("refusal"), scriptedError("refusal"));
    const error = await runner().run(call()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelChainError);
    expect((error as ModelChainError).attempts).toHaveLength(4);
    expect((error as ModelChainError).budgetExceeded).toBe(false);
  });

  it("propagates errors that are not ModelErrors", async () => {
    claude.script("claude-opus-5-5", () => {
      throw new TypeError("bug");
    });
    await expect(runner().run(call())).rejects.toThrow("bug");
  });
});

describe("resting a model", () => {
  const exhaust = () => Array.from({ length: 4 }, () => scriptedError("overloaded"));

  it("rests a model after 3 exhausted failures within the window, and skips it while resting", async () => {
    const rests = new RestRegistry();
    const r = runner(DEFAULT_MODEL_POLICY, rests);
    for (let i = 0; i < 3; i++) {
      claude.script("claude-opus-5-5", ...exhaust());
      claude.script("claude-opus-5", ok());
      await r.run(call());
    }
    expect(rests.snapshot(clock.now())["claude:claude-opus-5-5"]).toMatchObject({ resting: true });
    claude.script("claude-opus-5", ok());
    attempts = [];
    await r.run(call());
    expect(attempts[0]).toMatchObject({ model: "claude-opus-5-5", outcome: "skipped_resting" });
  });

  it("does not rest when failures are spread beyond the window", async () => {
    const rests = new RestRegistry();
    const r = runner(DEFAULT_MODEL_POLICY, rests);
    for (let i = 0; i < 3; i++) {
      claude.script("claude-opus-5-5", ...exhaust());
      claude.script("claude-opus-5", ok());
      await r.run(call());
      clock.advance(130_000);
    }
    expect(rests.snapshot(clock.now())["claude:claude-opus-5-5"]).toMatchObject({ resting: false });
  });

  it("allows one probe after the rest; a failed probe doubles the rest, a good one restores the model", async () => {
    const rests = new RestRegistry();
    const policy = DEFAULT_MODEL_POLICY.resting;
    const key = "claude:claude-opus-5-5";
    for (let i = 0; i < 3; i++) rests.recordExhausted(key, clock.now(), policy);
    expect(rests.acquire(key, clock.now())).toBe("resting");

    clock.advance(60_000);
    const r = runner(DEFAULT_MODEL_POLICY, rests);
    claude.script("claude-opus-5-5", scriptedError("overloaded"));
    claude.script("claude-opus-5", ok());
    attempts = [];
    await r.run(call());
    // probe gets exactly one attempt, no backoff
    expect(attempts.filter((a) => a.model === "claude-opus-5-5")).toHaveLength(1);
    expect(rests.acquire(key, clock.now() + 119_999)).toBe("resting");

    clock.advance(120_000);
    claude.script("claude-opus-5-5", ok("back"));
    expect((await r.run(call())).value.answer).toBe("back");
    expect(rests.acquire(key, clock.now())).toBe("ok");
  });

  it("caps a doubling rest at maxRestMs", () => {
    const rests = new RestRegistry();
    const policy = DEFAULT_MODEL_POLICY.resting;
    const key = "k";
    for (let i = 0; i < 3; i++) rests.recordExhausted(key, 0, policy);
    let now = 0;
    let last = 0;
    for (let i = 0; i < 8; i++) {
      now += 10_000_000;
      expect(rests.acquire(key, now)).toBe("probe");
      last = rests.recordExhausted(key, now, policy)!.restMs;
    }
    expect(last).toBe(600_000);
  });

  it("gives only one concurrent caller the probe", () => {
    const rests = new RestRegistry();
    for (let i = 0; i < 3; i++) rests.recordExhausted("k", 0, DEFAULT_MODEL_POLICY.resting);
    expect(rests.acquire("k", 60_000)).toBe("probe");
    expect(rests.acquire("k", 60_000)).toBe("resting");
  });

  it("shares rest state across runners (sessions)", async () => {
    const rests = new RestRegistry();
    for (let i = 0; i < 3; i++) rests.recordExhausted("claude:claude-opus-5-5", clock.now(), DEFAULT_MODEL_POLICY.resting);
    claude.script("claude-opus-5", ok());
    await runner(DEFAULT_MODEL_POLICY, rests).run(call());
    expect(claude.calls.map((c) => c.model)).toEqual(["claude-opus-5"]);
  });
});

describe("step budget", () => {
  it("stops retrying a model when the next backoff would pass the budget, then tries the next model", async () => {
    const policy = ModelPolicySchema.parse({ ...DEFAULT_MODEL_POLICY, resting: { stepBudgetMs: 5_000 } });
    claude.script("claude-opus-5-5", scriptedError("rate_limit", 10_000));
    claude.script("claude-opus-5", ok());
    const result = await runner(policy).run(call());
    expect(result.model).toBe("claude-opus-5");
    expect(clock.sleeps).toEqual([]);
  });

  it("throws a budget error when time runs out mid-chain", async () => {
    const policy = ModelPolicySchema.parse({ ...DEFAULT_MODEL_POLICY, resting: { stepBudgetMs: 5_000 } });
    claude.script("claude-opus-5-5", { ...scriptedError("server"), latencyMs: 6_000 });
    const error = await runner(policy).run(call()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelChainError);
    expect((error as ModelChainError).budgetExceeded).toBe(true);
  });

  it("passes the remaining budget down as the request timeout", async () => {
    const policy = ModelPolicySchema.parse({ ...DEFAULT_MODEL_POLICY, timeoutMs: 60_000, resting: { stepBudgetMs: 20_000 } });
    claude.script("claude-opus-5-5", ok());
    await runner(policy).run(call());
    expect(claude.calls[0]!.timeoutMs).toBe(20_000);
  });
});
