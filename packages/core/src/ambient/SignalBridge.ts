import type { AmbientEvent } from "../types/AmbientEvent.ts";
import type { AmbientSource } from "../types/AmbientSource.ts";
import type { Signal } from "../types/Signal.ts";
import type { Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

const clockTime = (iso: string) => iso.slice(11, 16);

/**
 * Turns ambient events into signals for the loop. Tool progress goes through immediately,
 * addressed to its subscription. Everything else is batched by a window of virtual time, so
 * a busy day becomes a manageable number of reasoning sessions. Batching is by time only;
 * the model decides what matters.
 */
export class SignalBridge {
  windowSeconds: number;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly send: (signal: Signal) => void;
  private buffer: { event: AmbientEvent; source: AmbientSource }[] = [];
  private windowStart: number | null = null;
  /** The latest location-type observation, for "where the user is now". */
  location: string | null = null;

  constructor(options: { clock: Clock; send: (signal: Signal) => void; windowSeconds?: number; ids?: IdGenerator }) {
    this.clock = options.clock;
    this.send = options.send;
    this.windowSeconds = options.windowSeconds ?? 600;
    this.ids = options.ids ?? randomIds;
  }

  accept(event: AmbientEvent, source: AmbientSource): void {
    if (event.kind === "location") this.location = event.content;
    if (event.kind === "tool_progress" && source.ownerSubscriptionId) {
      this.send({
        id: this.ids.next("signal"),
        kind: "tool_progress",
        source: source.name,
        occurredAt: event.at,
        content: event.content,
        data: { status: event.data.status, ambientEventId: event.id },
        sessionId: null,
        uiRequestId: null,
        subscriptionId: source.ownerSubscriptionId,
      });
      return;
    }
    this.windowStart ??= Date.parse(event.at);
    this.buffer.push({ event, source });
  }

  /** Sends the batch once its window of virtual time has passed (or right away with force). */
  flush(force = false): Signal | null {
    if (!this.buffer.length || this.windowStart === null) return null;
    if (!force && this.clock.now() - this.windowStart < this.windowSeconds * 1000) return null;
    const batch = this.buffer;
    this.buffer = [];
    this.windowStart = null;
    const kinds = new Set(batch.map((b) => b.event.kind));
    const signal: Signal = {
      id: this.ids.next("signal"),
      kind: kinds.size === 1 && kinds.has("location") ? "location" : "ambient",
      source: [...new Set(batch.map((b) => b.source.name))].join(", "),
      occurredAt: batch[0]!.event.at,
      content: batch.map((b) => `[${clockTime(b.event.at)}] ${b.event.content}`).join("\n"),
      data: { eventIds: batch.map((b) => b.event.id), count: batch.length },
      sessionId: null,
      uiRequestId: null,
      subscriptionId: null,
    };
    this.send(signal);
    return signal;
  }

  clear(): void {
    this.buffer = [];
    this.windowStart = null;
    this.location = null;
  }
}
