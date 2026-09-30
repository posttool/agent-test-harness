import type { ModelPolicyRunner } from "../model/ModelPolicyRunner.ts";
import { RouteDecisionSchema } from "../types/RouteDecision.ts";
import type { ReasoningSession } from "../types/ReasoningSession.ts";
import type { Signal } from "../types/Signal.ts";
import type { Trigger } from "../types/Trigger.ts";
import { isoAt, type Clock } from "../util/clock.ts";
import type { IdGenerator } from "../util/ids.ts";
import type { SessionManager } from "./SessionManager.ts";
import type { TraceStore } from "./TraceStore.ts";

export interface RouteResult {
  session: ReasoningSession;
  trigger: Trigger;
}

/**
 * Sends each signal to a session. UI feedback is addressed to the session that asked, so it
 * resumes that session directly. Every other signal is routed by a model call (P1).
 */
export interface TriggerRouterDeps {
  /** Resolves signals explicitly addressed to a session (tool progress for the call it started). */
  addressedSession?: (signal: Signal) => Promise<string | null> | string | null;
  runner: ModelPolicyRunner;
  sessions: SessionManager;
  traces: TraceStore;
  clock: Clock;
  ids: IdGenerator;
  prompt: string;
}

export class TriggerRouter {
  private readonly deps: TriggerRouterDeps;

  constructor(deps: TriggerRouterDeps) {
    this.deps = deps;
  }

  async route(signal: Signal): Promise<RouteResult> {
    const { sessions, traces } = this.deps;
    const triggerId = this.deps.ids.next("trigger");
    traces.append({ kind: "signal", triggerId, data: { signal } });

    if (signal.kind === "ui_feedback" && signal.sessionId) {
      const target = sessions.get(signal.sessionId);
      if (target?.status === "paused" && target.awaiting?.uiRequestId === signal.uiRequestId) {
        return this.bind(triggerId, signal, target, "resume", "UI feedback for the question this session asked");
      }
      traces.append({
        kind: "error",
        triggerId,
        data: { message: "UI feedback did not match a paused session; routing it like any other signal", sessionId: signal.sessionId },
      });
    }

    const addressed = await this.deps.addressedSession?.(signal);
    const addressedSession = addressed ? sessions.get(addressed) : undefined;
    if (addressedSession) {
      return this.bind(triggerId, signal, addressedSession, "addressed", "Progress for a process this session started");
    }

    const open = sessions.open();
    const result = await this.deps.runner.run({
      role: "router",
      schemaName: "RouteDecision",
      schema: RouteDecisionSchema,
      system: this.deps.prompt,
      context: [
        { kind: "signal", title: `${signal.kind} from ${signal.source} at ${signal.occurredAt}`, content: signal.content },
        {
          kind: "note",
          title: "Open sessions",
          content: open.length
            ? open.map((s) => `- ${s.id} [${s.status}] ${s.title}${s.summary ? `: ${s.summary}` : ""}`).join("\n")
            : "(none)",
        },
      ],
    });
    const decision = result.value;
    traces.append({ kind: "route", triggerId, data: { decision, model: result.model, attempts: result.attempts } });

    const target = decision.action === "continue" && decision.sessionId ? sessions.get(decision.sessionId) : undefined;
    if (decision.action === "continue" && (!target || !open.includes(target))) {
      traces.append({ kind: "error", triggerId, data: { message: "Router chose a session that is not open; starting a new one", decision } });
    }
    if (target && open.includes(target)) {
      return this.bind(triggerId, signal, target, "continue", decision.rationale);
    }
    const session = sessions.create(decision.title ?? signal.content.slice(0, 60));
    return this.bind(triggerId, signal, session, "new", decision.rationale);
  }

  private bind(triggerId: string, signal: Signal, session: ReasoningSession, decision: Trigger["decision"], rationale: string): RouteResult {
    const trigger: Trigger = { id: triggerId, signalId: signal.id, sessionId: session.id, routedAt: isoAt(this.deps.clock), decision, rationale };
    const updated = this.deps.sessions.update(session.id, { triggerIds: [...session.triggerIds, triggerId] });
    return { session: updated, trigger };
  }
}
