import type { ContextBlock } from "../types/ContextBlock.ts";
import type { ReasoningSession } from "../types/ReasoningSession.ts";
import type { ReasoningStep } from "../types/ReasoningStep.ts";
import type { SessionStatus } from "../types/SessionStatus.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

/**
 * Holds every reasoning session and its steps. Many sessions run at once; `exclusive`
 * makes work on any one session run in order.
 */
export class SessionManager {
  private readonly sessions = new Map<string, ReasoningSession>();
  private readonly steps = new Map<string, ReasoningStep>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(clock: Clock = systemClock, ids: IdGenerator = randomIds) {
    this.clock = clock;
    this.ids = ids;
  }

  create(title: string): ReasoningSession {
    const now = isoAt(this.clock);
    const session: ReasoningSession = {
      id: this.ids.next("session"),
      title,
      status: "active",
      triggerIds: [],
      stepIds: [],
      context: [],
      awaiting: null,
      summary: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ReasoningSession | undefined {
    return this.sessions.get(id);
  }

  require(id: string): ReasoningSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown session ${id}`);
    return session;
  }

  list(statuses?: readonly SessionStatus[]): ReasoningSession[] {
    const all = [...this.sessions.values()];
    return statuses ? all.filter((s) => statuses.includes(s.status)) : all;
  }

  /** Sessions a new signal could continue. */
  open(): ReasoningSession[] {
    return this.list(["active", "paused"]);
  }

  update(id: string, patch: Partial<Omit<ReasoningSession, "id" | "createdAt">>): ReasoningSession {
    const session = { ...this.require(id), ...patch, updatedAt: isoAt(this.clock) };
    this.sessions.set(id, session);
    return session;
  }

  appendContext(id: string, ...blocks: ContextBlock[]): ReasoningSession {
    const session = this.require(id);
    return this.update(id, { context: [...session.context, ...blocks] });
  }

  addStep(step: ReasoningStep): void {
    this.steps.set(step.id, step);
    const session = this.require(step.sessionId);
    if (!session.stepIds.includes(step.id)) this.update(step.sessionId, { stepIds: [...session.stepIds, step.id] });
  }

  updateStep(id: string, patch: Partial<ReasoningStep>): ReasoningStep {
    const step = { ...this.requireStep(id), ...patch };
    this.steps.set(id, step);
    return step;
  }

  requireStep(id: string): ReasoningStep {
    const step = this.steps.get(id);
    if (!step) throw new Error(`Unknown step ${id}`);
    return step;
  }

  stepsOf(sessionId: string): ReasoningStep[] {
    return this.require(sessionId).stepIds.map((id) => this.requireStep(id));
  }

  /** Runs `fn` after any earlier work on the same session has finished. */
  exclusive<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    this.queues.set(sessionId, next);
    return next;
  }

  clear(): void {
    this.sessions.clear();
    this.steps.clear();
    this.queues.clear();
  }
}
