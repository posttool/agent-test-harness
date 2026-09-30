import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_POLICY,
  ManualClock,
  ModelError,
  ModelPolicyRunner,
  NextStepDecisionSchema,
  ProxyProviderClient,
  ScriptedProviderClient,
  scriptedError,
  toProviderJsonSchema,
  type ProviderRequest,
} from "@harness/core";
import { createModelProxy } from "../server/modelProxy.ts";

const claude = new ScriptedProviderClient("claude");
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const proxy = createModelProxy({ claude });
  server = createServer((req, res) => void proxy(req, res).then((handled) => handled || res.writeHead(404).end()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const request: ProviderRequest = {
  model: "claude-opus-5-5",
  system: "s",
  context: [{ kind: "note", title: null, content: "c" }],
  schemaName: "NextStepDecision",
  jsonSchema: toProviderJsonSchema(NextStepDecisionSchema),
  effort: "high",
  maxOutputTokens: 100,
  timeoutMs: 5_000,
  serverFallback: true,
};

describe("model proxy", () => {
  it("passes requests through to the server-side client", async () => {
    claude.script("*", { value: { hello: "world" } });
    const response = await new ProxyProviderClient("claude", baseUrl).generate(request);
    expect(JSON.parse(response.text)).toEqual({ hello: "world" });
    expect(claude.calls.at(-1)).toMatchObject({ model: "claude-opus-5-5", effort: "high", serverFallback: true });
  });

  it("returns normalized errors, including retry-after", async () => {
    claude.script("*", { error: new ModelError("rate_limit", "slow down", { retryAfterMs: 3_000, status: 429 }) });
    const error = await new ProxyProviderClient("claude", baseUrl).generate(request).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "rate_limit", retryAfterMs: 3_000, status: 429 });
  });

  it("reports a provider with no key as an auth error, so the runner skips it", async () => {
    await expect(new ProxyProviderClient("gemini", baseUrl).generate(request)).rejects.toMatchObject({ kind: "auth" });
  });

  it("rejects malformed requests", async () => {
    const res = await fetch(`${baseUrl}/api/model/claude`, { method: "POST", body: JSON.stringify({ model: 1 }) });
    expect(res.status).toBe(400);
    const get = await fetch(`${baseUrl}/api/model/claude`);
    expect(get.status).toBe(405);
    const unknown = await fetch(`${baseUrl}/api/model/gpt`, { method: "POST", body: "{}" });
    expect(unknown.status).toBe(404);
  });

  it("maps an unreachable proxy to a network error", async () => {
    await expect(new ProxyProviderClient("claude", "http://127.0.0.1:1").generate(request)).rejects.toMatchObject({ kind: "network" });
  });

  it("works end to end with the resting runner in the browser position", async () => {
    claude.script("*", scriptedError("overloaded"), {
      value: { action: "end", capability: null, instruction: null, rationale: "r", summary: "s" },
    });
    const runner = new ModelPolicyRunner({
      clients: { claude: new ProxyProviderClient("claude", baseUrl), gemini: new ProxyProviderClient("gemini", baseUrl) },
      policy: DEFAULT_MODEL_POLICY,
      clock: new ManualClock(),
    });
    const result = await runner.run({ role: "loop", schemaName: "NextStepDecision", schema: NextStepDecisionSchema, system: "s", context: [] });
    expect(result.value.summary).toBe("s");
    expect(result.attempts.map((a) => a.errorKind)).toEqual(["overloaded", null]);
  });
});
