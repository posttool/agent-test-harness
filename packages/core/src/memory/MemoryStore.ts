import type { z } from "zod";
import type { StorageAdapter } from "../storage/StorageAdapter.ts";
import { VersionConflictError } from "../storage/StorageAdapter.ts";
import { CalendarEntrySchema, type CalendarEntry } from "../types/CalendarEntry.ts";
import type { Document } from "../types/Document.ts";
import type { DocumentRevision } from "../types/DocumentRevision.ts";
import { DocumentSectionSchema } from "../types/DocumentSection.ts";
import { DueDateSchema } from "../types/DueDate.ts";
import { CORE_EDGE_TYPES } from "../types/EdgeType.ts";
import { LifecycleStageSchema, type LifecycleStage } from "../types/LifecycleStage.ts";
import type { MemoryEdge } from "../types/MemoryEdge.ts";
import type { MemoryEvent } from "../types/MemoryEvent.ts";
import type { MemoryMutationPlan } from "../types/MemoryMutationPlan.ts";
import type { MemoryNode } from "../types/MemoryNode.ts";
import { CORE_NODE_TYPES } from "../types/NodeType.ts";
import { NoveltySummarySchema } from "../types/NoveltySummary.ts";
import { ProcessStatusSchema } from "../types/ProcessStatus.ts";
import { ProgressSchema } from "../types/Progress.ts";
import type { SchemaExtension } from "../types/SchemaExtension.ts";
import { SuggestedActionSchema } from "../types/SuggestedAction.ts";
import type { Topic } from "../types/Topic.ts";
import { TriggerOverrideSchema } from "../types/TriggerOverride.ts";
import { TriggerRuleSchema } from "../types/TriggerRule.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

export interface MutationContext {
  sessionId: string | null;
  signalId?: string | null;
  actor?: DocumentRevision["actor"];
}

export interface ApplyResult {
  eventId: string;
  changes: string[];
  errors: string[];
  /** Temporary refs in the plan mapped to the node ids they created. */
  refs: Record<string, string>;
}

export interface NodePatch {
  title?: string;
  summary?: string;
  /** Shallow-merged into the node's attributes; a null value removes the key. */
  attributes?: Record<string, unknown>;
  status?: MemoryNode["status"];
}

const FINISHED_STAGES: ReadonlySet<LifecycleStage> = new Set(["done", "archived"]);
const MAX_CONFLICT_RETRIES = 5;

/** Parses one field leniently: invalid or missing values fall back instead of failing. */
function field<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const result = schema.safeParse(value);
  return result.success ? result.data : fallback;
}

/** Parses each array item leniently, filling defaults the model may have left out. */
function items<T>(schema: z.ZodType<T>, value: unknown, defaults: Record<string, unknown> = {}): T[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const result = schema.safeParse(typeof item === "object" && item !== null ? { ...defaults, ...item } : item);
    return result.success ? [result.data] : [];
  });
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * The memory graph (PLAN.md section 5). Nodes and edges are the source of truth; topics,
 * documents and calendar entries are typed views over nodes of those types, read from
 * their attributes. Every change is recorded as an append-only MemoryEvent.
 */
export class MemoryStore {
  private readonly storage: StorageAdapter;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(storage: StorageAdapter, clock: Clock = systemClock, ids: IdGenerator = randomIds) {
    this.storage = storage;
    this.clock = clock;
    this.ids = ids;
  }

  // ---------- reads ----------

  node(id: string): Promise<MemoryNode | undefined> {
    return this.storage.get<MemoryNode>("nodes", id);
  }

  nodes(): Promise<MemoryNode[]> {
    return this.storage.list<MemoryNode>("nodes");
  }

  edges(): Promise<MemoryEdge[]> {
    return this.storage.list<MemoryEdge>("edges");
  }

  async events(limit = Infinity): Promise<MemoryEvent[]> {
    const all = (await this.storage.list<MemoryEvent>("events")).sort((a, b) => a.at.localeCompare(b.at));
    return all.slice(Math.max(0, all.length - limit));
  }

  schemaExtensions(): Promise<SchemaExtension[]> {
    return this.storage.list<SchemaExtension>("schemaExtensions");
  }

  async revisions(documentId?: string): Promise<DocumentRevision[]> {
    const all = await this.storage.list<DocumentRevision>("revisions");
    return all.filter((r) => documentId === undefined || r.documentId === documentId).sort((a, b) => a.at.localeCompare(b.at));
  }

  // ---------- typed views ----------

  async topics(): Promise<Topic[]> {
    const [nodes, edges] = await Promise.all([this.nodes(), this.edges()]);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const topicNodes = nodes.filter((n) => n.type === "topic");
    const documents = nodes.filter((n) => n.type === "document");
    return topicNodes.map((node) => {
      const a = node.attributes;
      const parentEdge = edges.find((e) => e.type === "part_of" && e.from === node.id && byId.get(e.to)?.type === "topic");
      const doc =
        documents.find((d) => d.attributes.topicId === node.id) ??
        documents.find((d) => edges.some((e) => e.type === "part_of" && e.from === d.id && e.to === node.id));
      return {
        id: node.id,
        title: node.title,
        category: str(a.category) ?? node.title,
        parentId: parentEdge?.to ?? null,
        stage: field(LifecycleStageSchema, a.stage, node.status === "archived" ? "archived" : "active"),
        documentId: doc?.id ?? null,
        meta: {
          triggers: items(TriggerRuleSchema, a.triggers, { qualifier: null, rationale: "" }),
          userOverrides: items(TriggerOverrideSchema, a.userOverrides, { rule: null, priority: null, note: "", createdAt: node.updatedAt }),
          summary: str(a.summary) ?? node.summary,
          newSinceLastSeen: field(NoveltySummarySchema.nullable(), a.newSinceLastSeen ?? null, null),
          progress: field(ProgressSchema.nullable(), a.progress ?? null, null),
          dueDates: items(DueDateSchema, a.dueDates, { source: "agent", label: "" }),
          lastUpdatedAt: node.updatedAt,
          lastSeenAt: str(a.lastSeenAt),
        },
      };
    });
  }

  async documents(): Promise<Document[]> {
    const [nodes, edges] = await Promise.all([this.nodes(), this.edges()]);
    const revisions = await this.revisions();
    return nodes
      .filter((n) => n.type === "document")
      .map((node) => {
        const a = node.attributes;
        const topicId =
          str(a.topicId) ?? edges.find((e) => e.type === "part_of" && e.from === node.id && nodes.find((n) => n.id === e.to)?.type === "topic")?.to ?? "";
        const sections = Array.isArray(a.sections) ? a.sections : [];
        return {
          id: node.id,
          topicId,
          title: node.title,
          description: str(a.description) ?? node.summary,
          sections: sections.flatMap((s, i) => {
            const r = DocumentSectionSchema.safeParse({ id: `s${i + 1}`, kind: "text", body: "", ...(s as object) });
            return r.success ? [r.data] : [];
          }),
          processes: items(ProcessStatusSchema, a.processes, { subscriptionId: null, detail: "", updatedAt: node.updatedAt }),
          results: strings(a.results),
          followUps: strings(a.followUps),
          suggestedActions: items(SuggestedActionSchema, a.suggestedActions, { toolId: null, functionName: null }),
          revisionIds: revisions.filter((r) => r.documentId === node.id).map((r) => r.id),
          archivedAt: str(a.archivedAt),
        };
      });
  }

  async calendar(): Promise<CalendarEntry[]> {
    return (await this.nodes())
      .filter((n) => n.type === "calendar_entry")
      .flatMap((node) => {
        const r = CalendarEntrySchema.safeParse({
          end: null,
          location: null,
          status: "penciled",
          source: "agent",
          topicId: null,
          ...node.attributes,
          id: node.id,
          title: node.title,
        });
        return r.success ? [r.data] : [];
      })
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  // ---------- writes ----------

  async recordEvent(kind: MemoryEvent["kind"], description: string, ctx: MutationContext, data: Record<string, unknown> = {}): Promise<MemoryEvent> {
    const event: MemoryEvent = {
      id: this.ids.next("event"),
      at: isoAt(this.clock),
      kind,
      signalId: ctx.signalId ?? null,
      sessionId: ctx.sessionId,
      description,
      data,
    };
    await this.storage.put("events", event);
    return event;
  }

  async createNode(input: { type: string; title: string; summary?: string; attributes?: Record<string, unknown> }, eventId: string, ctx: MutationContext): Promise<MemoryNode> {
    const now = isoAt(this.clock);
    const node: MemoryNode = {
      id: this.ids.next("node"),
      type: input.type,
      title: input.title,
      summary: input.summary ?? "",
      attributes: input.attributes ?? {},
      status: "live",
      version: 1,
      sourceEventIds: [eventId],
      createdAt: now,
      updatedAt: now,
    };
    await this.storage.put("nodes", node, 0);
    await this.noteExtension("node_type", input.type, ctx);
    if (node.type === "document") await this.addRevision(node.id, ctx, `Created: ${node.title}`);
    return node;
  }

  /** Applies a patch, re-reading and retrying when another writer got there first. */
  async updateNode(id: string, patch: NodePatch, eventId: string, ctx: MutationContext, action?: string): Promise<MemoryNode> {
    for (let attempt = 0; ; attempt++) {
      const current = await this.node(id);
      if (!current) throw new Error(`No node ${id}`);
      const attributes = { ...current.attributes };
      for (const [key, value] of Object.entries(patch.attributes ?? {})) {
        if (value === null) delete attributes[key];
        else attributes[key] = value;
      }
      const next: MemoryNode = {
        ...current,
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        attributes,
        version: current.version + 1,
        sourceEventIds: current.sourceEventIds.includes(eventId) ? current.sourceEventIds : [...current.sourceEventIds, eventId],
        updatedAt: isoAt(this.clock),
      };
      try {
        await this.storage.put("nodes", next, current.version);
      } catch (error) {
        if (error instanceof VersionConflictError && attempt < MAX_CONFLICT_RETRIES) continue;
        throw error;
      }
      if (next.type === "document") await this.addRevision(id, ctx, action ?? `Updated: ${Object.keys(patch.attributes ?? {}).join(", ") || "details"}`);
      if (next.type === "topic") await this.archiveDocumentsIfFinished(next, eventId, ctx);
      return next;
    }
  }

  async link(type: string, from: string, to: string, eventId: string, ctx: MutationContext): Promise<MemoryEdge> {
    const existing = (await this.edges()).find((e) => e.type === type && e.from === from && e.to === to);
    if (existing) return existing;
    const edge: MemoryEdge = { id: this.ids.next("edge"), type, from, to, version: 1, sourceEventIds: [eventId], createdAt: isoAt(this.clock) };
    await this.storage.put("edges", edge, 0);
    await this.noteExtension("edge_type", type, ctx);
    return edge;
  }

  async unlink(from: string, to: string, type: string | null): Promise<number> {
    const doomed = (await this.edges()).filter((e) => e.from === from && e.to === to && (type === null || e.type === type));
    await Promise.all(doomed.map((e) => this.storage.delete("edges", e.id)));
    return doomed.length;
  }

  async deleteNode(id: string): Promise<void> {
    const edges = (await this.edges()).filter((e) => e.from === id || e.to === id);
    await Promise.all(edges.map((e) => this.storage.delete("edges", e.id)));
    await this.storage.delete("nodes", id);
  }

  /** The user looked at a topic: new-since-last-seen resets. */
  async markSeen(topicId: string, ctx: MutationContext = { sessionId: null, actor: "user" }): Promise<void> {
    const event = await this.recordEvent("user_edit", `Seen: ${topicId}`, ctx);
    await this.updateNode(topicId, { attributes: { lastSeenAt: isoAt(this.clock), newSinceLastSeen: null } }, event.id, ctx);
  }

  /**
   * Applies a model's MemoryMutationPlan. Refs like `new-1` name nodes the plan creates and
   * can be used by later operations. Invalid operations are skipped and reported.
   */
  async applyPlan(plan: MemoryMutationPlan, ctx: MutationContext): Promise<ApplyResult> {
    const event = await this.recordEvent("mutation", plan.rationale, ctx, { operations: plan.operations.length });
    const refs: Record<string, string> = {};
    const changes: string[] = [];
    const errors: string[] = [];
    const resolve = (id: string | null) => (id === null ? null : (refs[id] ?? id));

    for (const [index, op] of plan.operations.entries()) {
      const label = `#${index + 1} ${op.op}`;
      try {
        let attributes: Record<string, unknown> | undefined;
        if (op.attributesJson) {
          const parsed: unknown = JSON.parse(op.attributesJson);
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("attributesJson must be a JSON object");
          attributes = parsed as Record<string, unknown>;
        }
        const nodeId = resolve(op.nodeId);
        switch (op.op) {
          case "create_node": {
            if (!op.type || !op.title) throw new Error("create_node needs type and title");
            const node = await this.createNode({ type: op.type, title: op.title, summary: op.summary ?? "", ...(attributes ? { attributes } : {}) }, event.id, ctx);
            if (op.ref) refs[op.ref] = node.id;
            changes.push(`created ${node.type} "${node.title}" as ${node.id}`);
            break;
          }
          case "update_node": {
            if (!nodeId || !(await this.node(nodeId))) throw new Error(`unknown node ${op.nodeId}`);
            const node = await this.updateNode(
              nodeId,
              { ...(op.title ? { title: op.title } : {}), ...(op.summary ? { summary: op.summary } : {}), ...(attributes ? { attributes } : {}) },
              event.id,
              ctx,
              op.reason,
            );
            changes.push(`updated ${node.id} "${node.title}"`);
            break;
          }
          case "link": {
            const from = resolve(op.from);
            const to = resolve(op.to);
            if (!op.edgeType || !from || !to) throw new Error("link needs edgeType, from and to");
            if (!(await this.node(from)) || !(await this.node(to))) throw new Error(`unknown node in link ${op.from} -> ${op.to}`);
            await this.link(op.edgeType, from, to, event.id, ctx);
            if ((await this.node(from))?.type === "document") await this.addRevision(from, ctx, `Linked ${op.edgeType} ${to}`);
            changes.push(`linked ${from} -${op.edgeType}-> ${to}`);
            break;
          }
          case "unlink": {
            const from = resolve(op.from);
            const to = resolve(op.to);
            if (!from || !to) throw new Error("unlink needs from and to");
            changes.push(`removed ${await this.unlink(from, to, op.edgeType)} link(s) ${from} -> ${to}`);
            break;
          }
          case "mark_stale":
          case "archive": {
            if (!nodeId || !(await this.node(nodeId))) throw new Error(`unknown node ${op.nodeId}`);
            const node = await this.node(nodeId);
            const archiving = op.op === "archive";
            await this.updateNode(
              nodeId,
              { status: archiving ? "archived" : "stale", ...(archiving && node?.type === "topic" ? { attributes: { stage: "archived" } } : {}) },
              event.id,
              ctx,
              op.reason,
            );
            changes.push(`${archiving ? "archived" : "marked stale"} ${nodeId}`);
            break;
          }
          case "delete": {
            if (!nodeId || !(await this.node(nodeId))) throw new Error(`unknown node ${op.nodeId}`);
            await this.deleteNode(nodeId);
            changes.push(`deleted ${nodeId}`);
            break;
          }
        }
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { eventId: event.id, changes, errors, refs };
  }

  async clear(): Promise<void> {
    await this.storage.clear();
  }

  // ---------- internals ----------

  private async addRevision(documentId: string, ctx: MutationContext, action: string): Promise<void> {
    const revision: DocumentRevision = {
      id: this.ids.next("rev"),
      documentId,
      at: isoAt(this.clock),
      actor: ctx.actor ?? "agent",
      action,
      sessionId: ctx.sessionId,
    };
    await this.storage.put("revisions", revision);
  }

  /** A document is archived when its project (topic) is finished. */
  private async archiveDocumentsIfFinished(topic: MemoryNode, eventId: string, ctx: MutationContext): Promise<void> {
    const stage = field(LifecycleStageSchema, topic.attributes.stage, "active");
    if (!FINISHED_STAGES.has(stage)) return;
    const docs = (await this.documents()).filter((d) => d.topicId === topic.id && d.archivedAt === null);
    for (const doc of docs) {
      await this.updateNode(doc.id, { attributes: { archivedAt: isoAt(this.clock) } }, eventId, ctx, `Archived: project ${stage}`);
    }
  }

  private async noteExtension(kind: SchemaExtension["kind"], name: string, ctx: MutationContext): Promise<void> {
    const core: readonly string[] = kind === "node_type" ? CORE_NODE_TYPES : CORE_EDGE_TYPES;
    if (core.includes(name)) return;
    const id = `${kind}:${name}`;
    if (await this.storage.get("schemaExtensions", id)) return;
    await this.storage.put<SchemaExtension>("schemaExtensions", {
      id,
      kind,
      name,
      description: `Added by the model (${kind.replace("_", " ")})`,
      proposedBySessionId: ctx.sessionId,
      at: isoAt(this.clock),
    });
  }
}
