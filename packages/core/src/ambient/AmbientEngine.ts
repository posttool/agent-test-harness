import type { StorageAdapter } from "../storage/StorageAdapter.ts";
import type { AmbientEvent } from "../types/AmbientEvent.ts";
import { AmbientScriptEventSchema, type AmbientScriptEvent } from "../types/AmbientScriptEvent.ts";
import type { AmbientSource } from "../types/AmbientSource.ts";
import type { Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";
import type { AmbientSink } from "../tools/SubscriptionManager.ts";

export type AmbientListener = (event: AmbientEvent, source: AmbientSource) => void | Promise<void>;
/** Supplies more events when a persistent generated source runs out (the simulator model). */
export type ScriptExtender = (source: AmbientSource) => Promise<AmbientScriptEvent[]>;

const RECENT_LIMIT = 200;

/**
 * Emits ambient events on the virtual clock (PLAN.md section 7). Every source is a script of
 * events with offsets from when the source started; each source has its own speed, and a
 * global switch pauses everything. Persistent generated sources ask for more events when
 * they run out.
 */
export class AmbientEngine implements AmbientSink {
  enabled = true;
  private readonly storage: StorageAdapter;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly listeners = new Set<AmbientListener>();
  private readonly extending = new Set<string>();
  private extender: ScriptExtender | null = null;
  private recent: AmbientEvent[] = [];

  constructor(options: { storage: StorageAdapter; clock: Clock; ids?: IdGenerator; extender?: ScriptExtender }) {
    this.storage = options.storage;
    this.clock = options.clock;
    this.ids = options.ids ?? randomIds;
    this.extender = options.extender ?? null;
  }

  setExtender(extender: ScriptExtender | null): void {
    this.extender = extender;
  }

  onEvent(listener: AmbientListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sources(): Promise<AmbientSource[]> {
    return this.storage.list<AmbientSource>("ambientSources");
  }

  recentEvents(): AmbientEvent[] {
    return [...this.recent];
  }

  async addSource(source: AmbientSource): Promise<void> {
    await this.storage.put("ambientSources", { ...source, startedAt: source.startedAt ?? this.clock.now() });
  }

  async removeSource(id: string): Promise<void> {
    await this.storage.delete("ambientSources", id);
  }

  async updateSource(id: string, patch: Partial<Pick<AmbientSource, "enabled" | "speed" | "name">>): Promise<void> {
    const source = await this.storage.get<AmbientSource>("ambientSources", id);
    if (!source) throw new Error(`No ambient source ${id}`);
    await this.storage.put("ambientSources", { ...source, ...patch });
  }

  async clear(): Promise<void> {
    for (const s of await this.sources()) await this.removeSource(s.id);
    this.recent = [];
  }

  /** Emits every event that is due at the current virtual time. */
  async tick(): Promise<AmbientEvent[]> {
    if (!this.enabled) return [];
    const now = this.clock.now();
    const emitted: AmbientEvent[] = [];
    for (const source of await this.sources()) {
      if (!source.enabled) continue;
      const events = scriptOf(source);
      const startedAt = source.startedAt ?? now;
      let cursor = source.cursor;
      const due: AmbientEvent[] = [];
      while (cursor < events.length) {
        const e = events[cursor]!;
        const at = startedAt + (e.offsetSeconds * 1000) / Math.max(source.speed, 0.0001);
        if (at > now) break;
        due.push({
          id: this.ids.next("ambient"),
          sourceId: source.id,
          kind: e.kind,
          at: new Date(at).toISOString(),
          content: e.content,
          data: { status: e.status, subscriptionId: source.ownerSubscriptionId },
        });
        cursor++;
      }
      if (due.length || source.startedAt === null) {
        await this.storage.put("ambientSources", { ...source, startedAt, cursor });
      }
      for (const event of due) {
        this.recent = [...this.recent, event].slice(-RECENT_LIMIT);
        emitted.push(event);
        for (const listener of this.listeners) await listener(event, source);
      }
      if (cursor >= events.length && source.lifecycle === "persistent" && typeof source.definition.prompt === "string") {
        void this.extend({ ...source, startedAt, cursor });
      }
    }
    return emitted;
  }

  private async extend(source: AmbientSource): Promise<void> {
    if (!this.extender || this.extending.has(source.id)) return;
    this.extending.add(source.id);
    try {
      const more = await this.extender(source);
      const current = await this.storage.get<AmbientSource>("ambientSources", source.id);
      if (!current || !more.length) return;
      const events = scriptOf(current);
      const lastOffset = events.at(-1)?.offsetSeconds ?? 0;
      const shifted = more.map((e) => ({ ...e, offsetSeconds: lastOffset + Math.max(e.offsetSeconds, 1) }));
      await this.storage.put("ambientSources", { ...current, definition: { ...current.definition, events: [...events, ...shifted] } });
    } finally {
      this.extending.delete(source.id);
    }
  }
}

export function scriptOf(source: AmbientSource): AmbientScriptEvent[] {
  const raw = Array.isArray(source.definition.events) ? source.definition.events : [];
  return raw.flatMap((e) => {
    const r = AmbientScriptEventSchema.safeParse(e);
    return r.success ? [r.data] : [];
  });
}
