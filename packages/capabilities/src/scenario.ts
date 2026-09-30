import {
  AgentReasoningLoop,
  DEFAULT_MODEL_POLICY,
  InMemoryStorage,
  ManualClock,
  MemoryStore,
  ModelPolicyRunner,
  SequentialIds,
  memoryWiring,
  renderMemory,
  type ProviderClient,
  type ReasoningSession,
  type Signal,
  type UiContext,
  type UiRequest,
} from "@harness/core";
import { loadCapabilities, loadPrompt } from "./load.ts";

/** A signal in a recorded scenario, before ids and timestamps are filled in. */
export interface ScenarioSignal {
  kind: Signal["kind"];
  source: string;
  content: string;
  /** Virtual minutes after the scenario starts. */
  atMinute: number;
}

/**
 * Runs signals through a fresh loop with in-memory memory, answering any blocking question
 * by picking its first offered option. Deterministic given the same model responses, so a
 * recorded run replays exactly.
 */
export async function runRecordedScenario(options: { client: ProviderClient; start: string; signals: ScenarioSignal[] }) {
  const clock = new ManualClock(Date.parse(options.start));
  const ids = new SequentialIds();
  const store = new MemoryStore(new InMemoryStorage(), clock, ids);
  const wiring = memoryWiring(store, {
    now: () => [{ kind: "note", title: "Now", content: new Date(clock.now()).toISOString() }],
  });
  const pending: { request: UiRequest; context: UiContext }[] = [];
  const loop = new AgentReasoningLoop({
    runner: new ModelPolicyRunner({ clients: { [options.client.provider]: options.client }, policy: DEFAULT_MODEL_POLICY, clock }),
    capabilities: await loadCapabilities(),
    prompts: { loop: await loadPrompt("loop"), router: await loadPrompt("router") },
    effects: wiring.effects,
    contextProviders: wiring.contextProviders,
    onUiRequest: (request, context) => {
      if (request.blocking) pending.push({ request, context });
    },
    clock,
    ids,
    maxStepsPerSession: 10,
  });

  const sent: Signal[] = [];
  const send = async (signal: Signal) => {
    sent.push(signal);
    await loop.handleSignal(signal);
    // Answer blocking questions with the first option offered.
    while (pending.length) {
      const { request, context } = pending.shift()!;
      const choice = request.component.elements.find((e) => e.kind === "choice" || e.kind === "button");
      const answer = choice?.items[0] ?? choice?.label ?? "Yes";
      const feedback: Signal = {
        id: ids.next("signal"),
        kind: "ui_feedback",
        source: "experience",
        occurredAt: new Date(clock.now()).toISOString(),
        content: answer,
        data: { feedback: { context, action: choice?.id ?? "ok", values: {}, at: new Date(clock.now()).toISOString() } },
        sessionId: context.sessionId,
        uiRequestId: context.uiRequestId,
        subscriptionId: null,
      };
      sent.push(feedback);
      await loop.handleSignal(feedback);
    }
  };

  const start = clock.now();
  for (const s of options.signals) {
    const at = start + s.atMinute * 60_000;
    if (at > clock.now()) clock.advance(at - clock.now());
    await send({
      id: ids.next("signal"),
      kind: s.kind,
      source: s.source,
      occurredAt: new Date(clock.now()).toISOString(),
      content: s.content,
      data: {},
      sessionId: null,
      uiRequestId: null,
      subscriptionId: null,
    });
  }
  const sessions: ReasoningSession[] = loop.sessions.list();
  return { sent, sessions, store, loop, memory: await renderMemory(store) };
}
