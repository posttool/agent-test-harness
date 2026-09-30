import { Ajv } from "ajv";
import type { ModelPolicyRunner } from "../model/ModelPolicyRunner.ts";
import type { StorageAdapter } from "../storage/StorageAdapter.ts";
import { LlmToolResultSchema } from "../types/LlmToolResult.ts";
import type { PendingApproval } from "../types/PendingApproval.ts";
import type { ToolCallRecord } from "../types/ToolCallRecord.ts";
import type { ToolDefinition } from "../types/ToolDefinition.ts";
import type { ToolFunction } from "../types/ToolFunction.ts";
import type { ToolInvocationPlan } from "../types/ToolInvocationPlan.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";
import type { BuiltinHandler } from "./builtins.ts";
import type { CodeSandbox } from "./CodeSandbox.ts";
import type { ToolRegistry } from "./ToolRegistry.ts";

const ajv = new Ajv({ strict: false, allErrors: true });

export interface ExecutorOptions {
  registry: ToolRegistry;
  storage: StorageAdapter;
  /** Built-in handlers keyed `toolId.functionName`. */
  builtins?: Record<string, BuiltinHandler>;
  sandbox?: CodeSandbox;
  runner?: ModelPolicyRunner;
  fetchImpl?: typeof fetch;
  /** MCP calls; injected so core stays free of transport details. */
  mcp?: (endpoint: string, functionName: string, args: Record<string, unknown>) => Promise<unknown>;
  clock?: Clock;
  ids?: IdGenerator;
  timeoutMs?: number;
}

export interface CallContext {
  sessionId: string | null;
  documentId: string | null;
}

export type ExecuteOutcome =
  | { kind: "ok"; call: ToolCallRecord; tool: ToolDefinition; fn: ToolFunction; result: unknown }
  | { kind: "needs_approval"; call: ToolCallRecord; tool: ToolDefinition; fn: ToolFunction; args: Record<string, unknown> }
  | { kind: "error"; call: ToolCallRecord | null; error: string };

const NEEDS_APPROVAL: ReadonlySet<ToolFunction["oversight"]> = new Set(["confirm", "always_ask"]);

/**
 * Runs tool functions (PLAN.md section 6): validates arguments against the function's JSON
 * Schema, enforces oversight (confirm / always_ask wait for the user), dispatches by tool
 * source, and records every call.
 */
export class ToolExecutor {
  private readonly o: ExecutorOptions;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: ExecutorOptions) {
    this.o = options;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? randomIds;
  }

  calls(): Promise<ToolCallRecord[]> {
    return this.o.storage.list<ToolCallRecord>("toolCalls");
  }

  approvals(): Promise<PendingApproval[]> {
    return this.o.storage.list<PendingApproval>("approvals");
  }

  /** Validates and either runs the call, or records it as waiting for approval. */
  async execute(plan: ToolInvocationPlan, ctx: CallContext): Promise<ExecuteOutcome> {
    const tool = await this.o.registry.get(plan.toolId);
    if (!tool) return { kind: "error", call: null, error: `No tool "${plan.toolId}". Use tools.discover first.` };
    const fn = tool.functions.find((f) => f.name === plan.functionName);
    if (!fn) return { kind: "error", call: null, error: `Tool ${tool.id} has no function "${plan.functionName}". It has: ${tool.functions.map((f) => f.name).join(", ")}.` };

    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(plan.argsJson || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      args = parsed as Record<string, unknown>;
    } catch {
      return { kind: "error", call: null, error: "argsJson must be a JSON object." };
    }
    const invalid = this.validate(fn, args);
    if (invalid) return { kind: "error", call: null, error: `Arguments do not match ${fn.name}'s parameters: ${invalid}` };

    const call = await this.record({ toolId: tool.id, functionName: fn.name, args, status: NEEDS_APPROVAL.has(fn.oversight) ? "awaiting_approval" : "running", sessionId: ctx.sessionId });
    if (NEEDS_APPROVAL.has(fn.oversight)) return { kind: "needs_approval", call, tool, fn, args };
    return this.run(call, tool, fn, args);
  }

  /** Stores an approval request once the UI for it has been shown. */
  async requestApproval(outcome: Extract<ExecuteOutcome, { kind: "needs_approval" }>, ctx: CallContext & { sessionId: string }, uiRequestId: string): Promise<PendingApproval> {
    const approval: PendingApproval = {
      id: this.ids.next("approval"),
      callId: outcome.call.id,
      toolId: outcome.tool.id,
      functionName: outcome.fn.name,
      argsJson: JSON.stringify(outcome.args),
      sessionId: ctx.sessionId,
      uiRequestId,
      documentId: ctx.documentId,
      status: "pending",
      createdAt: isoAt(this.clock),
    };
    await this.o.storage.put("approvals", approval);
    return approval;
  }

  async approvalFor(uiRequestId: string): Promise<PendingApproval | undefined> {
    return (await this.approvals()).find((a) => a.uiRequestId === uiRequestId && a.status === "pending");
  }

  /** The user answered an approval: run the call (with any edited arguments) or mark it denied. */
  async resolveApproval(approval: PendingApproval, approved: boolean, editedArgs: Record<string, unknown> = {}): Promise<ExecuteOutcome> {
    await this.o.storage.put("approvals", { ...approval, status: approved ? "approved" : "denied" });
    const call = await this.o.storage.get<ToolCallRecord>("toolCalls", approval.callId);
    const tool = await this.o.registry.get(approval.toolId);
    const fn = tool?.functions.find((f) => f.name === approval.functionName);
    if (!call || !tool || !fn) return { kind: "error", call: call ?? null, error: "The approved call no longer exists." };
    if (!approved) {
      const denied = { ...call, status: "denied" as const };
      await this.o.storage.put("toolCalls", denied);
      return { kind: "error", call: denied, error: "The user declined this call." };
    }
    const args = { ...(JSON.parse(approval.argsJson) as Record<string, unknown>), ...editedArgs };
    const invalid = this.validate(fn, args);
    if (invalid) return { kind: "error", call, error: `Edited arguments do not match ${fn.name}'s parameters: ${invalid}` };
    return this.run({ ...call, args, status: "running" }, tool, fn, args);
  }

  private validate(fn: ToolFunction, args: Record<string, unknown>): string | null {
    let validator;
    try {
      validator = ajv.compile(fn.params);
    } catch {
      return null; // an unusable schema is reported at registration; don't block the call
    }
    return validator(args) ? null : ajv.errorsText(validator.errors);
  }

  private async run(call: ToolCallRecord, tool: ToolDefinition, fn: ToolFunction, args: Record<string, unknown>): Promise<ExecuteOutcome> {
    try {
      const result = await this.dispatch(tool, fn, args);
      const done = { ...call, args, status: "ok" as const, result, error: null };
      await this.o.storage.put("toolCalls", done);
      return { kind: "ok", call: done, tool, fn, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = { ...call, args, status: "error" as const, error: message };
      await this.o.storage.put("toolCalls", failed);
      return { kind: "error", call: failed, error: message };
    }
  }

  private async dispatch(tool: ToolDefinition, fn: ToolFunction, args: Record<string, unknown>): Promise<unknown> {
    const timeout = this.o.timeoutMs ?? 30_000;
    switch (tool.source) {
      case "builtin": {
        const handler = this.o.builtins?.[`${tool.id}.${fn.name}`];
        if (!handler) throw new Error(`Built-in ${tool.id}.${fn.name} is not available here`);
        return handler(args);
      }
      case "generated_code": {
        if (!this.o.sandbox) throw new Error("No code sandbox is configured");
        return this.o.sandbox.run(tool.code ?? "", fn.name, args, timeout, tool.id);
      }
      case "llm": {
        if (!this.o.runner) throw new Error("No model runner is configured");
        const result = await this.o.runner.run({
          role: "simulator",
          schemaName: "LlmToolResult",
          schema: LlmToolResultSchema,
          system: `You are the tool "${tool.name}": ${tool.description}\n${tool.code ?? ""}\nPerform the function "${fn.name}" (${fn.description}). Return its result as JSON matching this schema: ${JSON.stringify(fn.returns)}`,
          context: [{ kind: "instruction", title: `${fn.name} arguments`, content: JSON.stringify(args) }],
        });
        try {
          return JSON.parse(result.value.resultJson) as unknown;
        } catch {
          return { text: result.value.resultJson, note: result.value.note };
        }
      }
      case "web_api": {
        if (!tool.endpoint) throw new Error("This tool has no endpoint");
        const response = await (this.o.fetchImpl ?? fetch)(tool.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ function: fn.name, args }),
          signal: AbortSignal.timeout(timeout),
        });
        const body = await response.text();
        if (!response.ok) throw new Error(`${tool.endpoint} returned ${response.status}: ${body.slice(0, 200)}`);
        try {
          return JSON.parse(body) as unknown;
        } catch {
          return { text: body };
        }
      }
      case "mcp": {
        if (!tool.endpoint) throw new Error("This tool has no endpoint");
        if (!this.o.mcp) throw new Error("No MCP client is configured");
        return this.o.mcp(tool.endpoint, fn.name, args);
      }
    }
  }

  private async record(partial: Pick<ToolCallRecord, "toolId" | "functionName" | "args" | "status" | "sessionId">): Promise<ToolCallRecord> {
    const call: ToolCallRecord = { id: this.ids.next("call"), result: null, error: null, subscriptionId: null, at: isoAt(this.clock), ...partial };
    await this.o.storage.put("toolCalls", call);
    return call;
  }
}
