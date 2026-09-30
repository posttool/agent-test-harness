import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ClaudeClient, GeminiClient, ModelError, NextStepDecisionSchema, toProviderJsonSchema, type ProviderRequest } from "../src/index.ts";

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let server: Server;
let baseUrl: string;
let handler: Handler;
let lastBody: Record<string, unknown>;
let lastHeaders: IncomingMessage["headers"];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastBody = body ? (JSON.parse(body) as Record<string, unknown>) : {};
      lastHeaders = req.headers;
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  handler = (_req, _body, res) => res.writeHead(500).end();
});

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
  res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));

const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "m",
  system: "sys",
  context: [{ kind: "note", title: null, content: "hello" }],
  schemaName: "NextStepDecision",
  jsonSchema: toProviderJsonSchema(NextStepDecisionSchema),
  effort: "high",
  maxOutputTokens: 1000,
  timeoutMs: 5000,
  serverFallback: true,
  ...overrides,
});

const decision = { action: "end", capability: null, instruction: null, rationale: "done", summary: "ok" };

describe("ClaudeClient", () => {
  const client = () => new ClaudeClient({ apiKey: "test", baseURL: baseUrl });
  const message = (overrides: Record<string, unknown> = {}) => ({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(decision) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
    ...overrides,
  });

  it("sends structured output, effort, cached system prompt and server fallback", async () => {
    handler = (_req, _b, res) => json(res, 200, message());
    const response = await client().generate(request());
    expect(JSON.parse(response.text)).toEqual(decision);
    expect(lastBody.output_config).toMatchObject({ effort: "high", format: { type: "json_schema" } });
    expect(lastBody.fallbacks).toBe("default");
    expect(String(lastHeaders["anthropic-beta"])).toContain("server-side-fallback-2026-07-01");
    expect(lastBody.system).toEqual([{ type: "text", text: "sys", cache_control: { type: "ephemeral" } }]);
    expect(response.usage).toMatchObject({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 1000 });
    expect(response.usage.costUsd).toBeCloseTo((100 * 4 + 50 * 20 + 1000 * 0.2) / 1_000_000);
  });

  it("omits fallbacks when the model ref turns server fallback off", async () => {
    handler = (_req, _b, res) => json(res, 200, message());
    await client().generate(request({ serverFallback: false, effort: null }));
    expect(lastBody.fallbacks).toBeUndefined();
    expect(lastBody.output_config).not.toHaveProperty("effort");
  });

  it.each([
    [429, "rate_limit", { "retry-after": "7" }, 7000],
    [529, "overloaded", {}, null],
    [503, "server", {}, null],
    [401, "auth", {}, null],
    [404, "not_found", {}, null],
    [400, "bad_request", {}, null],
  ] as const)("maps HTTP %i to %s", async (status, kind, headers, retryAfter) => {
    handler = (_req, _b, res) => json(res, status, { type: "error", error: { type: "x", message: "nope" } }, headers);
    const error = await client().generate(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).kind).toBe(kind);
    expect((error as ModelError).retryAfterMs).toBe(retryAfter);
  });

  it("turns a refusal stop reason into a refusal error", async () => {
    handler = (_req, _b, res) => json(res, 200, message({ stop_reason: "refusal", content: [], stop_details: { type: "refusal", category: "cyber", explanation: null } }));
    await expect(client().generate(request())).rejects.toMatchObject({ kind: "refusal" });
  });

  it("turns max_tokens into a max_tokens error", async () => {
    handler = (_req, _b, res) => json(res, 200, message({ stop_reason: "max_tokens" }));
    await expect(client().generate(request())).rejects.toMatchObject({ kind: "max_tokens" });
  });

  it("maps a request timeout to timeout", async () => {
    handler = () => undefined; // never respond
    await expect(client().generate(request({ timeoutMs: 200 }))).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("GeminiClient", () => {
  const client = () => new GeminiClient({ apiKey: "test", baseUrl });
  const content = (overrides: Record<string, unknown> = {}) => ({
    candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(decision) }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3 },
    modelVersion: "gemini-3.8-flash",
    ...overrides,
  });

  it("sends the JSON schema and system instruction, and reads usage", async () => {
    handler = (_req, _b, res) => json(res, 200, content());
    const response = await client().generate(request({ model: "gemini-3.8-flash", effort: null }));
    expect(JSON.parse(response.text)).toEqual(decision);
    const config = lastBody.generationConfig as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(JSON.stringify(lastBody.systemInstruction)).toContain("sys");
    expect(response.usage).toMatchObject({ inputTokens: 10, outputTokens: 8, costUsd: null });
  });

  it.each([
    [429, "rate_limit"],
    [503, "server"],
    [403, "auth"],
    [400, "bad_request"],
  ] as const)("maps HTTP %i to %s without retrying", async (status, kind) => {
    let calls = 0;
    handler = (_req, _b, res) => {
      calls++;
      json(res, status, { error: { code: status, message: "nope", status: "X" } });
    };
    await expect(client().generate(request())).rejects.toMatchObject({ kind });
    expect(calls).toBe(1);
  });

  it("treats a blocked prompt and a SAFETY finish as refusals", async () => {
    handler = (_req, _b, res) => json(res, 200, { promptFeedback: { blockReason: "SAFETY" } });
    await expect(client().generate(request())).rejects.toMatchObject({ kind: "refusal" });
    handler = (_req, _b, res) => json(res, 200, content({ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }));
    await expect(client().generate(request())).rejects.toMatchObject({ kind: "refusal" });
  });

  it("turns MAX_TOKENS into a max_tokens error", async () => {
    handler = (_req, _b, res) => json(res, 200, content({ candidates: [{ content: { parts: [{ text: "{" }] }, finishReason: "MAX_TOKENS" }] }));
    await expect(client().generate(request())).rejects.toMatchObject({ kind: "max_tokens" });
  });
});
