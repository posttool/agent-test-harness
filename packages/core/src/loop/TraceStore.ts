import type { TraceEntry } from "../types/TraceEntry.ts";
import type { TraceKind } from "../types/TraceKind.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

export interface TraceInput {
  kind: TraceKind;
  triggerId?: string | null;
  sessionId?: string | null;
  stepId?: string | null;
  data?: Record<string, unknown>;
}

type Listener = (entry: TraceEntry) => void;

/** Append-only log of every reasoning step, indexed by trigger and session (PLAN.md section 9, Traces). */
export class TraceStore {
  private readonly entries: TraceEntry[] = [];
  private readonly listeners = new Set<Listener>();
  private seq = 0;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(clock: Clock = systemClock, ids: IdGenerator = randomIds) {
    this.clock = clock;
    this.ids = ids;
  }

  append(input: TraceInput): TraceEntry {
    const entry: TraceEntry = {
      id: this.ids.next("trace"),
      seq: ++this.seq,
      at: isoAt(this.clock),
      kind: input.kind,
      triggerId: input.triggerId ?? null,
      sessionId: input.sessionId ?? null,
      stepId: input.stepId ?? null,
      data: input.data ?? {},
    };
    this.entries.push(entry);
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  list(filter: { triggerId?: string; sessionId?: string; kind?: TraceKind } = {}): TraceEntry[] {
    return this.entries.filter(
      (e) =>
        (filter.triggerId === undefined || e.triggerId === filter.triggerId) &&
        (filter.sessionId === undefined || e.sessionId === filter.sessionId) &&
        (filter.kind === undefined || e.kind === filter.kind),
    );
  }

  /** Trigger ids in the order they first appeared. */
  triggers(): string[] {
    return [...new Set(this.entries.flatMap((e) => (e.triggerId ? [e.triggerId] : [])))];
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.entries.length = 0;
    this.seq = 0;
  }
}
