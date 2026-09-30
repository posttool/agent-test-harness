import type { MemoryStore } from "../memory/MemoryStore.ts";
import { renderMemory } from "../memory/memoryView.ts";
import type { ModelPolicyRunner } from "../model/ModelPolicyRunner.ts";
import type { ContextBlock } from "../types/ContextBlock.ts";
import type { DeviceState } from "../types/DeviceState.ts";
import type { Document } from "../types/Document.ts";
import type { RenderOp } from "../types/RenderOp.ts";
import type { SurfaceItem } from "../types/SurfaceItem.ts";
import { SurfacePlanSchema, type SurfacePlan } from "../types/SurfacePlan.ts";
import type { UiComponentSpec } from "../types/UiComponentSpec.ts";
import type { UiContext } from "../types/UiContext.ts";
import type { UiElement } from "../types/UiElement.ts";
import type { UiRequest } from "../types/UiRequest.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

const SURFACE_SYSTEM = `You are the Device tool of a next-generation phone. You decide what the phone's surfaces show, given the user's memory and where and when they are.

- Contextual Brief: the few items that matter right now, most important first. Prefer what is relevant to this time and place (the grocery list at the store, a QR code at a venue), urgent changes (a moved test, an urgent message), and actions the user needs to take. Keep each item glanceable: a title, one line and a call to action. Never full detail. Tapping opens Spaces.
- Discover: a few topics related to the user's interests or projects that they did not ask for.
- Spaces: the documents of active projects the user is likely to want now.
- Respect each topic's triggers and the user's overrides (for example "never on the weekend").
- Dynamic Island: one or two words only while something is in progress, otherwise null.
Use only topic and document ids that appear in memory.`;

const el = (kind: UiElement["kind"], id: string, fields: Partial<UiElement> = {}): UiElement => ({
  kind,
  id,
  label: null,
  text: null,
  items: [],
  value: null,
  url: null,
  progress: null,
  fieldType: null,
  ...fields,
});

/** A document as a document_view component. Presentation only. */
export function documentComponent(doc: Document): UiComponentSpec {
  return {
    kind: "document_view",
    id: `doc-${doc.id}`,
    title: doc.title,
    primaryActionLabel: null,
    elements: [
      el("text", "description", { text: doc.description }),
      ...doc.sections.map((s) => el(s.kind === "list" || s.kind === "actions" ? "list" : "text", `section-${s.id}`, { label: s.title, text: s.body, items: s.kind === "list" || s.kind === "actions" ? s.body.split("\n").filter(Boolean) : [] })),
      ...doc.processes.map((p) => el("progress", `process-${p.id}`, { label: p.label, text: `${p.status}: ${p.detail}`, progress: p.status === "complete" ? 1 : p.status === "running" ? 0.5 : 0.1 })),
      ...(doc.results.length ? [el("list", "results", { label: "Results", items: doc.results })] : []),
      ...(doc.followUps.length ? [el("list", "follow-ups", { label: "Follow-ups", items: doc.followUps })] : []),
      ...doc.suggestedActions.map((a, i) => el("button", `action-${i}`, { label: a.label, value: a.toolId && a.functionName ? `${a.toolId}.${a.functionName}` : null })),
    ],
  };
}

/**
 * The Device tool (PLAN.md section 8). It owns the DeviceState the skin renders: UI the
 * loop asks for goes to the right surface, and a model call plans the Brief, Discover and
 * Spaces from memory and the current moment.
 */
export class DeviceTool {
  private state: DeviceState;
  readonly ops: RenderOp[] = [];
  private readonly runner: ModelPolicyRunner;
  private readonly memory: MemoryStore;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly listeners = new Set<(state: DeviceState) => void>();

  constructor(options: { runner: ModelPolicyRunner; memory: MemoryStore; clock?: Clock; ids?: IdGenerator }) {
    this.runner = options.runner;
    this.memory = options.memory;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? randomIds;
    this.state = this.blank();
  }

  private blank(): DeviceState {
    return { locked: true, island: { active: false, words: null }, brief: [], spaces: [], discover: [], notices: [], virtualTime: isoAt(this.clock), location: null };
  }

  snapshot(): DeviceState {
    return { ...structuredClone(this.state), virtualTime: isoAt(this.clock) };
  }

  onChange(listener: (state: DeviceState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  reset(): void {
    this.state = this.blank();
    this.ops.length = 0;
    this.changed();
  }

  setLocked(locked: boolean): void {
    this.state.locked = locked;
    this.changed();
  }

  setLocation(location: string | null): void {
    this.state.location = location;
    this.changed();
  }

  setIsland(active: boolean, words: string | null): void {
    this.state.island = { active, words: active ? words : null };
    this.changed();
  }

  private item(component: UiComponentSpec, context: UiContext | null, extra: Partial<SurfaceItem> = {}): SurfaceItem {
    return { id: this.ids.next("item"), component, context, topicId: context?.topicId ?? null, documentId: context?.documentId ?? null, reason: null, updatedAt: isoAt(this.clock), ...extra };
  }

  /** Places UI the loop asked for. Blocking questions go to Spaces with a pointer on the Brief. */
  show(request: UiRequest, context: UiContext): RenderOp {
    const item = this.item(request.component, context, { reason: request.question ?? request.rationale });
    let surface = request.surface;
    if (request.blocking || request.purpose === "disambiguation" || request.purpose === "document_view") surface = "intent_space";
    if (surface === "intent_space") {
      this.state.spaces = [item, ...this.state.spaces];
      if (request.blocking) {
        const pointer = this.item(
          { kind: "brief_item", id: `ask-${context.uiRequestId}`, title: "Needs your answer", primaryActionLabel: "Open", elements: [el("text", "q", { text: request.question ?? request.component.title ?? "" })] },
          context,
          { reason: "A question is waiting" },
        );
        this.state.brief = [pointer, ...this.state.brief];
      }
    } else if (surface === "discover") {
      this.state.discover = [item, ...this.state.discover];
    } else if (request.purpose === "notice") {
      this.state.notices = [item, ...this.state.notices].slice(0, 20);
    } else {
      this.state.brief = [item, ...this.state.brief];
    }
    const op: RenderOp = { surface, op: "set", component: request.component, context };
    this.ops.push(op);
    this.changed();
    return op;
  }

  /** A standalone notice (the device.notify built-in). */
  notice(text: string, title = "Notice"): SurfaceItem {
    const item = this.item({ kind: "notice", id: this.ids.next("notice"), title, primaryActionLabel: null, elements: [el("text", "t", { text })] }, null);
    this.state.notices = [item, ...this.state.notices].slice(0, 20);
    this.changed();
    return item;
  }

  /** The user answered; the question and its Brief pointer go away. */
  resolve(uiRequestId: string): void {
    const keep = (i: SurfaceItem) => i.context?.uiRequestId !== uiRequestId;
    this.state.spaces = this.state.spaces.filter(keep);
    this.state.brief = this.state.brief.filter(keep);
    this.state.notices = this.state.notices.filter(keep);
    this.changed();
  }

  dismiss(itemId: string): void {
    const keep = (i: SurfaceItem) => i.id !== itemId;
    this.state.brief = this.state.brief.filter(keep);
    this.state.notices = this.state.notices.filter(keep);
    this.state.discover = this.state.discover.filter(keep);
    this.changed();
  }

  /** Brings a document to the front of Spaces. */
  async openDocument(documentId: string): Promise<boolean> {
    const doc = (await this.memory.documents()).find((d) => d.id === documentId);
    if (!doc) return false;
    this.state.spaces = [this.item(documentComponent(doc), null, { documentId: doc.id, topicId: doc.topicId }), ...this.state.spaces.filter((i) => i.documentId !== doc.id || i.context)];
    this.changed();
    return true;
  }

  /** Re-plans the Brief, Discover and Spaces with one model call. Pending questions stay. */
  async refresh(now: ContextBlock[] = []): Promise<SurfacePlan> {
    const memory = await renderMemory(this.memory);
    const result = await this.runner.run({
      role: "device",
      schemaName: "SurfacePlan",
      schema: SurfacePlanSchema,
      system: SURFACE_SYSTEM,
      context: [{ kind: "memory", title: "Memory graph", content: memory }, ...now],
    });
    const plan = result.value;
    const documents = await this.memory.documents();
    const pending = (list: SurfaceItem[]) => list.filter((i) => i.context !== null);
    this.state.brief = [...pending(this.state.brief), ...plan.brief.map((b) => this.item(b.component, null, { topicId: b.topicId, reason: b.reason }))];
    this.state.discover = plan.discover.map((b) => this.item(b.component, null, { topicId: b.topicId, reason: b.reason }));
    const docs = plan.spaceDocumentIds.flatMap((id) => documents.filter((d) => d.id === id && !d.archivedAt));
    this.state.spaces = [...pending(this.state.spaces), ...docs.map((d) => this.item(documentComponent(d), null, { documentId: d.id, topicId: d.topicId }))];
    if (!this.state.island.active) this.state.island = { active: false, words: null };
    this.changed();
    return plan;
  }
}
