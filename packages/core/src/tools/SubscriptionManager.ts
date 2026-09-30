import type { MemoryStore } from "../memory/MemoryStore.ts";
import type { ModelPolicyRunner } from "../model/ModelPolicyRunner.ts";
import type { StorageAdapter } from "../storage/StorageAdapter.ts";
import type { AmbientEvent } from "../types/AmbientEvent.ts";
import { AmbientScriptSchema } from "../types/AmbientScript.ts";
import type { AmbientSource } from "../types/AmbientSource.ts";
import type { ProcessStatus } from "../types/ProcessStatus.ts";
import type { Subscription } from "../types/Subscription.ts";
import type { ToolCallRecord } from "../types/ToolCallRecord.ts";
import type { ToolDefinition } from "../types/ToolDefinition.ts";
import type { ToolFunction } from "../types/ToolFunction.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

/** Where subscriptions put their progress streams (the ambient engine, M5). */
export interface AmbientSink {
  addSource(source: AmbientSource): Promise<void>;
  removeSource(id: string): Promise<void>;
}

const STATUS_BY_EVENT: Record<string, ProcessStatus["status"]> = {
  info: "running",
  running: "running",
  snag: "snag",
  complete: "complete",
  failed: "failed",
};

/**
 * Long-running tool calls (PLAN.md section 6.5). Starting one asks the simulator model for a
 * realistic stream of progress events, which the ambient engine emits on the virtual clock.
 * Each event routes back to the session that started the call and updates its document.
 */
export class SubscriptionManager {
  private readonly storage: StorageAdapter;
  private readonly runner: ModelPolicyRunner;
  private readonly ambient: AmbientSink;
  private readonly memory: MemoryStore | null;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: { storage: StorageAdapter; runner: ModelPolicyRunner; ambient: AmbientSink; memory?: MemoryStore; clock?: Clock; ids?: IdGenerator }) {
    this.storage = options.storage;
    this.runner = options.runner;
    this.ambient = options.ambient;
    this.memory = options.memory ?? null;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? randomIds;
  }

  list(): Promise<Subscription[]> {
    return this.storage.list<Subscription>("subscriptions");
  }

  get(id: string): Promise<Subscription | undefined> {
    return this.storage.get<Subscription>("subscriptions", id);
  }

  async start(call: ToolCallRecord, tool: ToolDefinition, fn: ToolFunction, result: unknown, ctx: { sessionId: string; documentId: string | null }): Promise<Subscription> {
    const script = await this.runner.run({
      role: "simulator",
      schemaName: "AmbientScript",
      schema: AmbientScriptSchema,
      system:
        "You simulate the real world for a phone agent test harness. A tool call just started a real-world process. Write the progress events the process would send over its life, with realistic timing (offsetSeconds from now), ending with a complete event or, occasionally, a snag that needs the user. Use kind tool_progress and set status on every event.",
      context: [
        { kind: "instruction", title: `${tool.name}.${fn.name}`, content: `${fn.description}\nArguments: ${JSON.stringify(call.args)}\nResult: ${JSON.stringify(result)}` },
      ],
    });
    const now = isoAt(this.clock);
    const subscriptionId = this.ids.next("sub");
    const source: AmbientSource = {
      id: this.ids.next("source"),
      kind: "tool_progress",
      name: `${tool.name}: ${script.value.name}`,
      templateId: null,
      ratePerMinute: 0,
      speed: 1,
      enabled: true,
      startedAt: null,
      cursor: 0,
      lifecycle: "until_complete",
      ownerSubscriptionId: subscriptionId,
      definition: { description: script.value.description, events: script.value.events },
    };
    const subscription: Subscription = {
      id: subscriptionId,
      toolId: tool.id,
      functionName: fn.name,
      sessionId: ctx.sessionId,
      documentId: ctx.documentId,
      ambientSourceId: source.id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put("subscriptions", subscription);
    await this.storage.put("toolCalls", { ...call, subscriptionId });
    await this.ambient.addSource(source);
    await this.recordProcess(subscription, `${tool.name}: ${fn.name}`, { status: "starting", detail: script.value.description, args: call.args, result });
    await this.updateDocument(subscription, { status: "starting", detail: script.value.description, label: `${tool.name}: ${fn.name}` });
    return subscription;
  }

  /** Applies one progress event: updates the document and ends the subscription when the process is done. */
  async onEvent(event: AmbientEvent, subscriptionId: string): Promise<Subscription | undefined> {
    const subscription = await this.get(subscriptionId);
    if (!subscription || subscription.status !== "active") return subscription;
    const eventStatus = typeof event.data.status === "string" ? event.data.status : "running";
    const status = STATUS_BY_EVENT[eventStatus] ?? "running";
    await this.updateDocument(subscription, { status, detail: event.content });
    await this.recordProcess(subscription, null, { status, detail: event.content });
    if (status === "complete" || status === "failed") {
      const ended: Subscription = { ...subscription, status: status === "complete" ? "completed" : "failed", updatedAt: isoAt(this.clock) };
      await this.storage.put("subscriptions", ended);
      await this.ambient.removeSource(subscription.ambientSourceId);
      return ended;
    }
    return subscription;
  }

  /** The session a progress signal belongs to (for addressed routing). */
  async sessionFor(subscriptionId: string | null): Promise<string | null> {
    if (!subscriptionId) return null;
    return (await this.get(subscriptionId))?.sessionId ?? null;
  }

  /**
   * Every running process is an active_process node in memory (PLAN.md section 4.2), linked to
   * its document when there is one, so progress is visible even without a document.
   */
  private async recordProcess(subscription: Subscription, label: string | null, update: Record<string, unknown> & { status: string; detail: string }): Promise<void> {
    if (!this.memory) return;
    const ctx = { sessionId: subscription.sessionId, actor: "tool" as const };
    const existing = (await this.memory.nodes()).find((n) => n.type === "active_process" && n.attributes.subscriptionId === subscription.id);
    const event = await this.memory.recordEvent("mutation", `Process ${label ?? existing?.title ?? subscription.functionName}: ${update.status}`, ctx);
    const history = [...(Array.isArray(existing?.attributes.history) ? existing.attributes.history : []), { at: isoAt(this.clock), status: update.status, detail: update.detail }].slice(-20);
    const attributes = { subscriptionId: subscription.id, toolId: subscription.toolId, functionName: subscription.functionName, ...update, history };
    if (existing) {
      await this.memory.updateNode(existing.id, { summary: `${update.status}: ${update.detail}`, attributes }, event.id, ctx);
      return;
    }
    const node = await this.memory.createNode({ type: "active_process", title: label ?? subscription.functionName, summary: `${update.status}: ${update.detail}`, attributes }, event.id, ctx);
    if (subscription.documentId && (await this.memory.node(subscription.documentId))) await this.memory.link("executing_for", node.id, subscription.documentId, event.id, ctx);
  }

  private async updateDocument(subscription: Subscription, update: { status: ProcessStatus["status"]; detail: string; label?: string }): Promise<void> {
    if (!this.memory || !subscription.documentId) return;
    const doc = await this.memory.node(subscription.documentId);
    if (!doc) return;
    const processes = (Array.isArray(doc.attributes.processes) ? doc.attributes.processes : []) as ProcessStatus[];
    const existing = processes.find((p) => p.subscriptionId === subscription.id);
    const entry: ProcessStatus = {
      id: existing?.id ?? subscription.id,
      label: update.label ?? existing?.label ?? subscription.functionName,
      subscriptionId: subscription.id,
      status: update.status,
      detail: update.detail,
      updatedAt: isoAt(this.clock),
    };
    const next = existing ? processes.map((p) => (p === existing ? entry : p)) : [...processes, entry];
    const event = await this.memory.recordEvent("mutation", `Process ${entry.label}: ${update.status}`, { sessionId: subscription.sessionId, actor: "tool" });
    await this.memory.updateNode(doc.id, { attributes: { processes: next } }, event.id, { sessionId: subscription.sessionId, actor: "tool" }, `Process ${update.status}: ${update.detail}`);
  }
}
