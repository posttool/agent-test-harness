import { ModelChainError, type ModelPolicyRunner } from "../model/ModelPolicyRunner.ts";
import { isOutputSchemaName, OUTPUT_SCHEMAS } from "../schemas/outputSchemas.ts";
import type { CapabilitySpec } from "../types/CapabilitySpec.ts";
import type { ContextBlock } from "../types/ContextBlock.ts";
import { NextStepDecisionSchema, type NextStepDecision } from "../types/NextStepDecision.ts";
import type { ReasoningSession } from "../types/ReasoningSession.ts";
import type { ReasoningStep } from "../types/ReasoningStep.ts";
import type { Signal } from "../types/Signal.ts";
import type { UiContext } from "../types/UiContext.ts";
import type { UiRequest } from "../types/UiRequest.ts";
import { isoAt, systemClock, type Clock } from "../util/clock.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";
import { SessionManager } from "./SessionManager.ts";
import { TraceStore } from "./TraceStore.ts";
import { TriggerRouter } from "./TriggerRouter.ts";

export interface CapabilityContext {
  session: ReasoningSession;
  step: ReasoningStep;
  triggerId: string;
  /** Hands UI to the device and returns its uiRequestId. Pausing is up to the effect. */
  showUi: (request: UiRequest, where?: { documentId?: string | null; topicId?: string | null }) => string;
}

export interface EffectResult {
  /** Pause the session until UI feedback for this request arrives. */
  awaitUi?: { uiRequestId: string };
  /** Extra text appended to the step's context block (e.g. what was written to memory). */
  note?: string;
}

/** Applies a capability's output to the world (memory, tools, the device). */
export type CapabilityEffect = (output: unknown, ctx: CapabilityContext) => Promise<EffectResult | void> | EffectResult | void;

/** Supplies extra context a capability needs (e.g. a view of the memory graph). */
export type ContextProvider = (session: ReasoningSession, instruction: string) => Promise<ContextBlock[]> | ContextBlock[];

export interface LoopOptions {
  runner: ModelPolicyRunner;
  capabilities: CapabilitySpec[];
  prompts: { loop: string; router: string };
  effects?: Record<string, CapabilityEffect>;
  contextProviders?: Record<string, ContextProvider>;
  /** Called whenever the agent wants UI shown (the Device tool renders it). */
  onUiRequest?: (request: UiRequest, context: UiContext) => void;
  /** Called when UI feedback resumes a session; returned blocks are added to its context (e.g. an approved tool's result). */
  onResume?: (session: ReasoningSession, signal: Signal) => Promise<ContextBlock[]> | ContextBlock[];
  /** Extra context for every next-step decision (e.g. the tool catalog). */
  decisionContext?: () => Promise<ContextBlock[]> | ContextBlock[];
  /** Resolves signals addressed to a session (e.g. tool progress to the session that started it). */
  addressedSession?: (signal: Signal) => Promise<string | null> | string | null;
  sessions?: SessionManager;
  traces?: TraceStore;
  clock?: Clock;
  ids?: IdGenerator;
  /** Safety limit on steps per session. */
  maxStepsPerSession?: number;
  /** How many malformed decisions in a row before the session fails. */
  maxInvalidDecisions?: number;
}

/**
 * The primary control loop (PLAN.md section 4). A model call routes each signal, then a model
 * call picks each next capability until the session ends or pauses for the user.
 */
export class AgentReasoningLoop {
  readonly sessions: SessionManager;
  readonly traces: TraceStore;
  readonly router: TriggerRouter;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly capabilities: Map<string, CapabilitySpec>;
  private readonly decisionPrompt: string;
  private readonly options: LoopOptions;

  constructor(options: LoopOptions) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? randomIds;
    this.sessions = options.sessions ?? new SessionManager(this.clock, this.ids);
    this.traces = options.traces ?? new TraceStore(this.clock, this.ids);
    this.capabilities = new Map(options.capabilities.map((c) => [c.id, c]));
    for (const spec of options.capabilities) {
      if (!isOutputSchemaName(spec.outputSchema)) throw new Error(`Capability ${spec.id} names unknown output schema ${spec.outputSchema}`);
    }
    this.router = new TriggerRouter({
      runner: options.runner,
      sessions: this.sessions,
      traces: this.traces,
      clock: this.clock,
      ids: this.ids,
      prompt: options.prompts.router,
      ...(options.addressedSession ? { addressedSession: options.addressedSession } : {}),
    });
    // Stable across calls, so providers can cache it.
    this.decisionPrompt = [
      options.prompts.loop,
      "## Capabilities",
      ...options.capabilities.map((c) => `- ${c.id} (${c.title}): ${c.whenToUse}`),
    ].join("\n\n");
  }

  /** Routes a signal and runs the session it lands in until that session ends or pauses. */
  async handleSignal(signal: Signal): Promise<ReasoningSession> {
    const { session, trigger } = await this.router.route(signal);

    if (trigger.decision === "resume") {
      await this.sessions.exclusive(session.id, async () => this.resume(session, signal, trigger.id));
    } else if (trigger.decision === "addressed") {
      this.sessions.appendContext(session.id, {
        kind: "signal",
        title: `${signal.kind} from ${signal.source} at ${signal.occurredAt}`,
        content: signal.content,
      });
      const current = this.sessions.require(session.id);
      if (current.status === "paused") return current;
      this.sessions.update(session.id, { status: "active" });
    } else {
      this.sessions.appendContext(session.id, {
        kind: "signal",
        title: `${signal.kind} from ${signal.source} at ${signal.occurredAt}`,
        content: signal.content,
      });
      if (session.status === "paused") {
        // Still waiting for the user; keep the new information for when they answer.
        return this.sessions.require(session.id);
      }
    }
    return this.sessions.exclusive(session.id, () => this.run(session.id, trigger.id));
  }

  private async resume(session: ReasoningSession, signal: Signal, triggerId: string): Promise<void> {
    const stepId = session.awaiting?.stepId;
    if (stepId) this.sessions.updateStep(stepId, { status: "ok", finishedAt: isoAt(this.clock) });
    this.sessions.appendContext(session.id, {
      kind: "feedback",
      title: "The user answered",
      content: JSON.stringify({ said: signal.content, ...signal.data }),
    });
    const extra = (await this.options.onResume?.(session, signal)) ?? [];
    if (extra.length) this.sessions.appendContext(session.id, ...extra);
    this.sessions.update(session.id, { status: "active", awaiting: null });
    this.traces.append({ kind: "session_resumed", triggerId, sessionId: session.id, stepId: stepId ?? null, data: { signal } });
  }

  private async run(sessionId: string, triggerId: string): Promise<ReasoningSession> {
    const maxSteps = this.options.maxStepsPerSession ?? 12;
    const maxInvalid = this.options.maxInvalidDecisions ?? 2;
    let invalid = 0;

    while (true) {
      const session = this.sessions.require(sessionId);
      if (session.status !== "active") return session;
      if (session.stepIds.length >= maxSteps) return this.fail(sessionId, triggerId, null, `Stopped after ${maxSteps} steps`);

      let decision: NextStepDecision;
      try {
        const result = await this.options.runner.run({
          role: "loop",
          schemaName: "NextStepDecision",
          schema: NextStepDecisionSchema,
          system: this.decisionPrompt,
          context: [...session.context, ...((await this.options.decisionContext?.()) ?? [])],
        });
        decision = result.value;
        this.traces.append({ kind: "decision", triggerId, sessionId, data: { decision, model: result.model, attempts: result.attempts, usage: result.usage } });
      } catch (error) {
        return this.handleError(error, sessionId, triggerId, null);
      }

      if (decision.action === "end") {
        const ended = this.sessions.update(sessionId, { status: "ended", summary: decision.summary ?? decision.rationale });
        this.traces.append({ kind: "session_ended", triggerId, sessionId, data: { summary: ended.summary } });
        return ended;
      }

      const spec = decision.capability ? this.capabilities.get(decision.capability) : undefined;
      if (!spec || !decision.instruction) {
        invalid++;
        const message = !spec
          ? `"${decision.capability}" is not an available capability. Choose one of: ${[...this.capabilities.keys()].join(", ")}.`
          : "A step needs an instruction.";
        this.traces.append({ kind: "error", triggerId, sessionId, data: { message, decision } });
        if (invalid > maxInvalid) return this.fail(sessionId, triggerId, null, `Too many invalid decisions: ${message}`);
        this.sessions.appendContext(sessionId, { kind: "error", title: "Invalid decision", content: message });
        continue;
      }
      invalid = 0;

      const paused = await this.runStep(spec, decision, sessionId, triggerId);
      if (paused) return this.sessions.require(sessionId);
    }
  }

  /** Runs one capability. Returns true when the session paused for the user. */
  private async runStep(spec: CapabilitySpec, decision: NextStepDecision, sessionId: string, triggerId: string): Promise<boolean> {
    const instruction = decision.instruction ?? "";
    const session = this.sessions.require(sessionId);
    const step: ReasoningStep = {
      id: this.ids.next("step"),
      sessionId,
      index: session.stepIds.length,
      capability: spec.id,
      instruction,
      rationale: decision.rationale,
      status: "running",
      output: null,
      error: null,
      startedAt: isoAt(this.clock),
      finishedAt: null,
    };
    this.sessions.addStep(step);
    this.traces.append({ kind: "step_start", triggerId, sessionId, stepId: step.id, data: { capability: spec.id, instruction } });

    try {
      const extra = (await this.options.contextProviders?.[spec.id]?.(session, instruction)) ?? [];
      const result = await this.options.runner.run({
        role: spec.role,
        schemaName: spec.outputSchema,
        schema: OUTPUT_SCHEMAS[spec.outputSchema as keyof typeof OUTPUT_SCHEMAS] as never,
        system: spec.instructions,
        context: [...session.context, ...extra, { kind: "instruction", title: `Your task (${spec.id})`, content: instruction }],
      });
      const output: unknown = result.value;
      const effect = this.options.effects?.[spec.id] ?? (spec.id === "ui.generate" ? this.showUi : undefined);
      const current = this.sessions.updateStep(step.id, { output });
      const showUi: CapabilityContext["showUi"] = (request, where) => {
        const uiRequestId = this.ids.next("ui");
        this.options.onUiRequest?.(request, { sessionId, uiRequestId, stepId: step.id, documentId: where?.documentId ?? null, topicId: where?.topicId ?? null });
        return uiRequestId;
      };
      const effectResult = (await effect?.(output, { session: this.sessions.require(sessionId), step: current, triggerId, showUi })) ?? {};

      this.sessions.appendContext(sessionId, {
        kind: "step",
        title: `${spec.id}: ${instruction}`,
        content: JSON.stringify(output) + (effectResult.note ? `\n${effectResult.note}` : ""),
      });
      this.traces.append({
        kind: "step_result",
        triggerId,
        sessionId,
        stepId: step.id,
        data: { output, note: effectResult.note ?? null, model: result.model, attempts: result.attempts, usage: result.usage },
      });

      if (effectResult.awaitUi) {
        this.sessions.updateStep(step.id, { status: "awaiting_ui" });
        this.sessions.update(sessionId, { status: "paused", awaiting: { kind: "ui", uiRequestId: effectResult.awaitUi.uiRequestId, stepId: step.id } });
        this.traces.append({ kind: "session_paused", triggerId, sessionId, stepId: step.id, data: { uiRequestId: effectResult.awaitUi.uiRequestId } });
        return true;
      }
      this.sessions.updateStep(step.id, { status: "ok", finishedAt: isoAt(this.clock) });
      return false;
    } catch (error) {
      await this.handleError(error, sessionId, triggerId, step.id);
      return true;
    }
  }

  /** Built-in effect for ui.generate: hand the request to the device, pause if it blocks. */
  private readonly showUi: CapabilityEffect = (output, ctx) => {
    const request = output as UiRequest;
    const uiRequestId = ctx.showUi(request);
    return request.blocking ? { awaitUi: { uiRequestId }, note: `Shown to the user as ${uiRequestId}; waiting for the answer.` } : { note: `Shown as ${uiRequestId}.` };
  };

  private async handleError(error: unknown, sessionId: string, triggerId: string, stepId: string | null): Promise<ReasoningSession> {
    if (!(error instanceof ModelChainError)) throw error;
    return this.fail(sessionId, triggerId, stepId, error.message, { attempts: error.attempts, budgetExceeded: error.budgetExceeded });
  }

  private fail(sessionId: string, triggerId: string, stepId: string | null, message: string, data: Record<string, unknown> = {}): ReasoningSession {
    if (stepId) this.sessions.updateStep(stepId, { status: "failed", error: message, finishedAt: isoAt(this.clock) });
    this.traces.append({ kind: "error", triggerId, sessionId, stepId, data: { message, ...data } });
    return this.sessions.update(sessionId, { status: "failed", error: message });
  }
}
