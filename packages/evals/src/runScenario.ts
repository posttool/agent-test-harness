import {
  JudgeVerdictSchema,
  ModelPolicyRunner,
  UiAnswerSchema,
  renderMemory,
  type ModelAttempt,
  type ModelPolicy,
  type ProviderClient,
  type ProviderId,
  type SurfaceItem,
} from "@harness/core";
import type { HarnessRuntime } from "@harness/runtime";
import type { Scenario } from "./types/Scenario.ts";
import type { ScenarioResult } from "./types/ScenarioResult.ts";

export interface EvalTarget {
  /** Label in the report, e.g. "claude". */
  name: string;
  policy: ModelPolicy;
}

export interface EvalDeps {
  /** A fresh runtime for each run (in-memory storage, surfaces refreshed manually). */
  makeRuntime: (policy: ModelPolicy) => Promise<HarnessRuntime>;
  /** Judge and user simulator: fixed, separate from the model under test. */
  judge: { clients: Partial<Record<ProviderId, ProviderClient>>; policy: ModelPolicy };
  maxAnswers?: number;
}

const describeUi = (item: SurfaceItem) =>
  JSON.stringify({ title: item.component.title, question: item.reason, elements: item.component.elements.map((e) => ({ kind: e.kind, id: e.id, label: e.label, text: e.text, items: e.items, value: e.value })) });

/** Plays a scenario against one target and asks the judge whether the rubric holds. */
export async function runScenario(scenario: Scenario, target: EvalTarget, deps: EvalDeps): Promise<ScenarioResult> {
  const started = Date.now();
  const rt = await deps.makeRuntime(target.policy);
  const judgeRunner = new ModelPolicyRunner({ clients: deps.judge.clients, policy: deps.judge.policy });
  const attempts: ModelAttempt[] = [];
  rt.traces.subscribe((t) => {
    if (Array.isArray(t.data.attempts)) attempts.push(...(t.data.attempts as ModelAttempt[]));
  });
  let uiAnswers = 0;
  let error: string | null = null;

  /** Answers every open question as the simulated user would. */
  const answerQuestions = async () => {
    for (let i = 0; i < (deps.maxAnswers ?? 6); i++) {
      const open = rt.device.snapshot().spaces.find((s) => s.context);
      if (!open?.context) return;
      const answer = await judgeRunner.run({
        role: "simulator",
        schemaName: "UiAnswer",
        schema: UiAnswerSchema,
        system: `You play the user of a phone agent in a test. Answer the question the phone shows, the way this user would.\nThe user: ${scenario.user}\nPick an element id that exists (a choice, or a button such as approve), fill any form fields by id, and say it briefly in your own words.`,
        context: [{ kind: "instruction", title: "The phone is asking", content: describeUi(open) }],
      });
      uiAnswers++;
      await rt.sendFeedback(
        { context: open.context, action: answer.value.action, values: Object.fromEntries(answer.value.values.map((v) => [v.fieldId, v.value])), at: new Date(rt.clock.now()).toISOString() },
        answer.value.said,
      );
      await rt.idle();
    }
  };

  try {
    for (const name of scenario.tools) await rt.handle({ type: "tool_add_suggestion", name });
    const start = Date.parse(scenario.start);
    rt.clock.set(start);
    rt.clock.speed = 1;
    for (const step of scenario.steps) {
      const at = start + step.atMinute * 60_000;
      await advanceTo(rt, at, answerQuestions);
      await rt.sendSignal(step.kind, step.source, step.content);
      await rt.idle();
      await answerQuestions();
    }
    await advanceTo(rt, rt.clock.now() + scenario.settleMinutes * 60_000, answerQuestions);
    rt.bridge.flush(true);
    await rt.idle();
    await answerQuestions();
    if (scenario.refreshSurfaces) await rt.device.refresh(rt.now()).catch((e: unknown) => (error = `surface refresh failed: ${String(e)}`));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const snap = await rt.snapshot();
  const device = snap.device;
  const evidence = [
    `## Memory\n${await renderMemory(rt.memory)}`,
    `## Contextual Brief\n${device.brief.map((b) => `- ${b.component.title}: ${b.reason ?? ""} ${b.component.elements.map((e) => e.text ?? e.items.join(", ")).join(" ")}`).join("\n") || "(empty)"}`,
    `## Spaces\n${device.spaces.map((s) => `- ${s.component.title}`).join("\n") || "(empty)"}`,
    `## Tool calls\n${snap.tools.calls.map((c) => `- ${c.toolId}.${c.functionName} ${JSON.stringify(c.args)} → ${c.status}`).join("\n") || "(none)"}`,
    `## Sessions\n${snap.sessions.map((s) => `- ${s.title} [${s.status}] ${s.summary ?? s.error ?? ""}`).join("\n")}`,
  ].join("\n\n");

  let verdict = null;
  try {
    verdict = (
      await judgeRunner.run({
        role: "judge",
        schemaName: "JudgeVerdict",
        schema: JudgeVerdictSchema,
        system:
          "You grade a test run of a personal agent. Decide whether every rubric item holds, using only the evidence. Pass only if all items hold. Score 0 to 1 is the fraction of items that hold. Give one reason per item.",
        context: [
          { kind: "instruction", title: `Scenario: ${scenario.title}`, content: `Rubric:\n${scenario.rubric.map((r, i) => `${i + 1}. ${r}`).join("\n")}` },
          { kind: "note", title: "Evidence", content: evidence },
        ],
      })
    ).value;
  } catch (e) {
    error = error ?? `judge failed: ${e instanceof Error ? e.message : String(e)}`;
  }

  const ok = attempts.filter((a) => a.outcome === "ok");
  const costs = ok.map((a) => a.usage?.costUsd ?? null);
  return {
    scenarioId: scenario.id,
    provider: target.name,
    verdict,
    error,
    sessions: snap.sessions.length,
    failedSessions: snap.sessions.filter((s) => s.status === "failed").length,
    steps: snap.steps.length,
    modelCalls: ok.length,
    fallbacks: new Set(ok.map((a) => a.model)).size - 1,
    uiAnswers,
    wallMs: Date.now() - started,
    costUsd: costs.some((c) => c === null) ? null : costs.reduce<number>((s, c) => s + (c ?? 0), 0),
    tokens: { input: ok.reduce((s, a) => s + (a.usage?.inputTokens ?? 0) + (a.usage?.cacheReadTokens ?? 0), 0), output: ok.reduce((s, a) => s + (a.usage?.outputTokens ?? 0), 0) },
    evidence,
  };
}

/** Moves virtual time forward minute by minute so ambient streams and tool progress play out. */
async function advanceTo(rt: HarnessRuntime, target: number, between: () => Promise<void>): Promise<void> {
  while (rt.clock.now() < target) {
    const step = Math.min(60_000, target - rt.clock.now());
    rt.clock.set(rt.clock.now() + step);
    await rt.ambient.tick();
    rt.bridge.flush();
    await rt.idle();
    await between();
  }
}
