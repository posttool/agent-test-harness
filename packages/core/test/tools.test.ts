import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_MODEL_POLICY,
  InMemoryStorage,
  ManualClock,
  MemoryStore,
  ModelPolicyRunner,
  ScriptedProviderClient,
  SequentialIds,
  SubscriptionManager,
  ToolExecutor,
  ToolRegistry,
  mcpCall,
  type AmbientSource,
  type ToolInvocationPlan,
  type ToolProposal,
} from "../src/index.ts";
import { VmSandbox } from "../src/node/index.ts";

const invoke = (toolId: string, functionName: string, args: unknown = {}, documentId: string | null = null): ToolInvocationPlan => ({
  toolId,
  functionName,
  argsJson: JSON.stringify(args),
  argsFromMemory: [],
  documentId,
  rationale: "test",
});

const schema = (props: Record<string, unknown>, required: string[] = Object.keys(props)) =>
  JSON.stringify({ type: "object", properties: props, required, additionalProperties: false });

const cartTool: ToolProposal = {
  name: "Cart",
  description: "A shopping cart",
  source: "generated_code",
  endpoint: null,
  code: `
    let items = [];
    async function add_to_cart(args) { items.push(args.item); return { items }; }
    async function checkout(args) { return { ordered: args.card + ":" + items.length }; }
    async function forever() { while (true) {} }
    async function sneaky() { return typeof require + "," + typeof process + "," + typeof fetch; }
  `,
  functions: [
    { name: "add_to_cart", description: "Add an item", paramsJsonSchema: schema({ item: { type: "string" } }), returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: false },
    { name: "checkout", description: "Pay for the cart", paramsJsonSchema: schema({ card: { type: "string" } }), returnsJsonSchema: "{}", oversight: "always_ask", longRunning: false },
    { name: "forever", description: "Never returns", paramsJsonSchema: "{}", returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: false },
    { name: "sneaky", description: "Looks for globals", paramsJsonSchema: "{}", returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: false },
  ],
};

let storage: InMemoryStorage;
let registry: ToolRegistry;
let executor: ToolExecutor;
let clock: ManualClock;
let ids: SequentialIds;
const ctx = { sessionId: "session_1", documentId: null };

beforeEach(() => {
  clock = new ManualClock(0);
  ids = new SequentialIds();
  storage = new InMemoryStorage();
  registry = new ToolRegistry(storage, clock, ids);
  executor = new ToolExecutor({
    registry,
    storage,
    sandbox: new VmSandbox(),
    builtins: { "device.notify": (args) => ({ shown: args.text }) },
    clock,
    ids,
    timeoutMs: 500,
  });
});

describe("ToolRegistry", () => {
  it("always lists the built-in web and device tools, which cannot be deleted", async () => {
    expect((await registry.list()).map((t) => t.id)).toEqual(["web", "device"]);
    await expect(registry.delete("web")).rejects.toThrow("built-in");
  });

  it("registers a proposed tool after validating each function's schemas", async () => {
    const tool = await registry.registerProposal(cartTool, "session_1", "generate_code");
    expect(tool.functions.map((f) => [f.name, f.oversight])).toContainEqual(["checkout", "always_ask"]);
    expect(await registry.render()).toContain("checkout [always_ask]");
    await expect(
      registry.registerProposal({ ...cartTool, functions: [{ ...cartTool.functions[0]!, paramsJsonSchema: "{not json" }] }, null, "x"),
    ).rejects.toThrow("not valid JSON");
    await expect(
      registry.registerProposal({ ...cartTool, functions: [{ ...cartTool.functions[0]!, paramsJsonSchema: '{"type": 12}' }] }, null, "x"),
    ).rejects.toThrow("not a valid JSON Schema");
    await expect(registry.registerProposal({ ...cartTool, code: null }, null, "x")).rejects.toThrow("needs code");
  });
});

describe("ToolExecutor", () => {
  it("runs built-ins and records the call", async () => {
    const out = await executor.execute(invoke("device", "notify", { text: "hi" }), ctx);
    expect(out).toMatchObject({ kind: "ok", result: { shown: "hi" } });
    expect((await executor.calls())[0]).toMatchObject({ toolId: "device", functionName: "notify", status: "ok" });
  });

  it("rejects unknown tools, unknown functions and arguments that fail the schema", async () => {
    expect(await executor.execute(invoke("nope", "x"), ctx)).toMatchObject({ kind: "error", error: expect.stringContaining("tools.discover") });
    expect(await executor.execute(invoke("device", "fly"), ctx)).toMatchObject({ kind: "error", error: expect.stringContaining("has no function") });
    expect(await executor.execute(invoke("device", "notify", { words: 1 }), ctx)).toMatchObject({ kind: "error", error: expect.stringContaining("must have required property 'text'") });
    expect(await executor.execute({ ...invoke("device", "notify"), argsJson: "[1]" }, ctx)).toMatchObject({ kind: "error", error: "argsJson must be a JSON object." });
  });

  it("runs generated code in a sandbox with no ambient permissions, keeping each tool's state between calls", async () => {
    const tool = await registry.registerProposal(cartTool, null, "generate_code");
    expect(await executor.execute(invoke(tool.id, "add_to_cart", { item: "oat milk" }), ctx)).toMatchObject({ kind: "ok", result: { items: ["oat milk"] } });
    expect(await executor.execute(invoke(tool.id, "add_to_cart", { item: "eggs" }), ctx)).toMatchObject({ kind: "ok", result: { items: ["oat milk", "eggs"] } });
    const twin = await registry.registerProposal(cartTool, null, "generate_code");
    expect(await executor.execute(invoke(twin.id, "add_to_cart", { item: "bread" }), ctx)).toMatchObject({ kind: "ok", result: { items: ["bread"] } });
    expect(await executor.execute(invoke(tool.id, "sneaky"), ctx)).toMatchObject({ kind: "ok", result: "undefined,undefined,undefined" });
    expect(await executor.execute(invoke(tool.id, "forever"), ctx)).toMatchObject({ kind: "error", error: expect.stringContaining("timed out") });
  });

  it("holds always_ask calls for the user, then runs them with the user's edits", async () => {
    const tool = await registry.registerProposal(cartTool, null, "generate_code");
    const out = await executor.execute(invoke(tool.id, "checkout", { card: "visa" }), ctx);
    expect(out.kind).toBe("needs_approval");
    if (out.kind !== "needs_approval") return;
    expect((await executor.calls()).find((c) => c.id === out.call.id)!.status).toBe("awaiting_approval");
    const approval = await executor.requestApproval(out, ctx, "ui_1");
    expect(await executor.approvalFor("ui_1")).toMatchObject({ id: approval.id, status: "pending" });

    const ran = await executor.resolveApproval(approval, true, { card: "amex" });
    expect(ran).toMatchObject({ kind: "ok", result: { ordered: "amex:0" } });
    expect(await executor.approvalFor("ui_1")).toBeUndefined();
  });

  it("marks a declined call as denied", async () => {
    const tool = await registry.registerProposal(cartTool, null, "generate_code");
    const out = await executor.execute(invoke(tool.id, "checkout", { card: "visa" }), ctx);
    if (out.kind !== "needs_approval") throw new Error("expected approval");
    const approval = await executor.requestApproval(out, ctx, "ui_2");
    expect(await executor.resolveApproval(approval, false)).toMatchObject({ kind: "error", error: "The user declined this call." });
    expect((await executor.calls()).find((c) => c.id === out.call.id)!.status).toBe("denied");
  });

  it("runs llm tools through the model runner", async () => {
    const claude = new ScriptedProviderClient("claude");
    claude.script("*", { value: { resultJson: '{"questions":["2x+1=5"]}', note: "made one question" } });
    const runner = new ModelPolicyRunner({ clients: { claude }, policy: DEFAULT_MODEL_POLICY, clock });
    const ex = new ToolExecutor({ registry, storage, runner, clock, ids });
    const tool = await registry.registerProposal(
      { name: "Tutor", description: "Writes practice questions", source: "llm", endpoint: null, code: "You are a patient algebra tutor.", functions: [{ name: "practice", description: "Make questions", paramsJsonSchema: schema({ topic: { type: "string" } }), returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: false }] },
      null,
      "llm_tool",
    );
    expect(await ex.execute(invoke(tool.id, "practice", { topic: "substitution" }), ctx)).toMatchObject({ kind: "ok", result: { questions: ["2x+1=5"] } });
    expect(claude.calls[0]).toMatchObject({ schemaName: "LlmToolResult", effort: "low" });
    expect(claude.calls[0]!.system).toContain("patient algebra tutor");
  });
});

describe("web_api and mcp tools", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (req.url === "/api") {
        let body = "";
        for await (const chunk of req) body += chunk;
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ echo: JSON.parse(body) }));
        return;
      }
      if (req.url === "/mcp") {
        const mcp = new McpServer({ name: "test", version: "1.0.0" });
        mcp.registerTool("ride_quote", { description: "Quote a ride", inputSchema: { to: z.string() } }, async ({ to }) => ({
          content: [{ type: "text", text: JSON.stringify({ to, price: 18 }) }],
        }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on("close", () => void transport.close());
        await mcp.connect(transport);
        let body = "";
        for await (const chunk of req) body += chunk;
        await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("posts web_api calls to the tool's endpoint", async () => {
    const tool = await registry.registerProposal(
      { name: "Echo", description: "echo", source: "web_api", endpoint: `${base}/api`, code: null, functions: [{ name: "ping", description: "ping", paramsJsonSchema: "{}", returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: false }] },
      null,
      "wrap_api",
    );
    expect(await executor.execute(invoke(tool.id, "ping", { n: 1 }), ctx)).toMatchObject({ kind: "ok", result: { echo: { function: "ping", args: { n: 1 } } } });
  });

  it("calls MCP servers", async () => {
    expect(await mcpCall(`${base}/mcp`, "ride_quote", { to: "work" })).toEqual({ to: "work", price: 18 });
    const ex = new ToolExecutor({ registry, storage, mcp: mcpCall, clock, ids });
    const tool = await registry.registerProposal(
      { name: "Rides", description: "rides", source: "mcp", endpoint: `${base}/mcp`, code: null, functions: [{ name: "ride_quote", description: "quote", paramsJsonSchema: schema({ to: { type: "string" } }), returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: false }] },
      null,
      "wrap_mcp",
    );
    expect(await ex.execute(invoke(tool.id, "ride_quote", { to: "home" }), ctx)).toMatchObject({ kind: "ok", result: { to: "home", price: 18 } });
  });
});

describe("SubscriptionManager", () => {
  it("scripts progress for a long-running call, tracks it on the document, and ends on complete", async () => {
    const claude = new ScriptedProviderClient("claude");
    claude.script("*", {
      value: {
        name: "Ride to work",
        kind: "tool_progress",
        description: "Driver assigned and on the way",
        events: [
          { offsetSeconds: 60, kind: "tool_progress", content: "Driver Ana is 4 minutes away", status: "running" },
          { offsetSeconds: 900, kind: "tool_progress", content: "Arrived at work", status: "complete" },
        ],
      },
    });
    const runner = new ModelPolicyRunner({ clients: { claude }, policy: DEFAULT_MODEL_POLICY, clock });
    const memory = new MemoryStore(storage, clock, ids);
    const doc = (await memory.applyPlan({ rationale: "r", needsUserConfirmation: false, question: null, operations: [{ op: "create_node", ref: "d", type: "document", title: "Commute", nodeId: null, summary: null, attributesJson: null, edgeType: null, from: null, to: null, reason: "r" }] }, { sessionId: "session_1" })).refs.d!;
    const sources: AmbientSource[] = [];
    const removed: string[] = [];
    const subs = new SubscriptionManager({ storage, runner, memory, clock, ids, ambient: { addSource: async (s) => void sources.push(s), removeSource: async (id) => void removed.push(id) } });
    const tool = await registry.registerProposal(
      { name: "Rides", description: "rides", source: "generated_code", endpoint: null, code: "async function order(a){return {rideId:'r1'}}", functions: [{ name: "order", description: "Order a ride", paramsJsonSchema: "{}", returnsJsonSchema: "{}", oversight: "auto_from_memory", longRunning: true }] },
      null,
      "generate_code",
    );
    const call = await executor.execute(invoke(tool.id, "order"), ctx);
    if (call.kind !== "ok") throw new Error("expected ok");

    const sub = await subs.start(call.call, call.tool, call.fn, call.result, { sessionId: "session_1", documentId: doc });
    expect(sources[0]).toMatchObject({ kind: "tool_progress", lifecycle: "until_complete", ownerSubscriptionId: sub.id });
    expect((sources[0]!.definition.events as unknown[]).length).toBe(2);
    expect(await subs.sessionFor(sub.id)).toBe("session_1");
    expect((await memory.documents())[0]!.processes[0]).toMatchObject({ status: "starting", subscriptionId: sub.id });

    await subs.onEvent({ id: "e1", sourceId: sources[0]!.id, kind: "tool_progress", at: "t", content: "Driver Ana is 4 minutes away", data: { status: "running" } }, sub.id);
    expect((await memory.documents())[0]!.processes[0]).toMatchObject({ status: "running", detail: "Driver Ana is 4 minutes away" });
    const ended = await subs.onEvent({ id: "e2", sourceId: sources[0]!.id, kind: "tool_progress", at: "t", content: "Arrived at work", data: { status: "complete" } }, sub.id);
    expect(ended!.status).toBe("completed");
    const process = (await memory.nodes()).find((n) => n.type === "active_process")!;
    expect(process).toMatchObject({ title: "Rides: order", attributes: { status: "complete", subscriptionId: sub.id } });
    expect((process.attributes.history as unknown[]).length).toBe(3);
    expect((await memory.edges()).some((e) => e.type === "executing_for" && e.from === process.id && e.to === doc)).toBe(true);
    expect(removed).toEqual([sources[0]!.id]);
    expect((await memory.revisions(doc)).map((r) => r.actor)).toContain("tool");
  });
});
