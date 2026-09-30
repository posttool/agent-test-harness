import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_POLICY, ScriptedProviderClient, SequentialIds, type ProviderRequest, type ScriptedReply } from "@harness/core";
import { createNodeRuntime } from "@harness/runtime/node";
import { markdownReport, runScenario, ScenarioSchema, type Scenario } from "../src/index.ts";

describe("scenario files", () => {
  const files = readdirSync("samples/scenarios").filter((f) => f.endsWith(".json"));
  it("ships the five scenarios from PLAN.md", () => {
    expect(files.map((f) => f.replace(".json", "")).sort()).toEqual(["dinner-conflict", "grocery-at-store", "ride-cancel", "sofa-nudge", "test-prep-grows"]);
  });
  it.each(files)("%s is a valid scenario", (f) => {
    const s = ScenarioSchema.parse(JSON.parse(readFileSync(`samples/scenarios/${f}`, "utf8")));
    expect(s.rubric.length).toBeGreaterThan(1);
  });
});

describe("runScenario (scripted)", () => {
  it("plays steps, answers questions as the user, asks the judge, and reports", async () => {
    const scenario: Scenario = ScenarioSchema.parse({
      id: "demo",
      title: "Demo",
      user: "Likes blue.",
      start: "2026-05-20T08:00:00Z",
      steps: [{ atMinute: 0, content: "buy a sweater" }, { atMinute: 30, kind: "location", source: "location", content: "Arriving at the mall" }],
      rubric: ["asked about color", "ended"],
      refreshSurfaces: true,
    });
    const agent = new ScriptedProviderClient("claude");
    const judge = new ScriptedProviderClient("claude");
    let asked = false;
    agent.handler = (req: ProviderRequest): ScriptedReply => {
      const last = req.context.at(-1);
      if (req.schemaName === "RouteDecision") return { value: { action: "new", sessionId: null, title: "t", rationale: "r" } };
      if (req.schemaName === "UiRequest")
        return { value: { purpose: "disambiguation", surface: "intent_space", blocking: true, question: "Color?", rationale: "r", component: { kind: "choice_group", id: "c", title: "Color", primaryActionLabel: null, elements: [{ kind: "choice", id: "color", label: null, text: null, items: ["Blue", "Red"], value: null, url: null, progress: null, fieldType: null }] } } };
      if (req.schemaName === "SurfacePlan") return { value: { islandWords: null, brief: [], discover: [], spaceDocumentIds: [], rationale: "r" } };
      if (!asked && last?.kind === "signal") {
        asked = true;
        return { value: { action: "step", capability: "ui.generate", instruction: "ask", rationale: "r", summary: null } };
      }
      return { value: { action: "end", capability: null, instruction: null, rationale: "r", summary: last?.kind === "feedback" ? `answer: ${last.content}` : "noted" } };
    };
    judge.handler = (req: ProviderRequest): ScriptedReply =>
      req.schemaName === "UiAnswer"
        ? { value: { action: "color", values: [{ fieldId: "color", value: "Blue" }], said: "Blue please" } }
        : { value: { pass: true, score: 1, reasons: ["asked", "ended"] } };

    const result = await runScenario(scenario, { name: "claude", policy: DEFAULT_MODEL_POLICY }, {
      judge: { clients: { claude: judge }, policy: DEFAULT_MODEL_POLICY },
      makeRuntime: () => createNodeRuntime({ root: process.cwd(), env: {}, clients: { claude: agent }, overrides: { ids: new SequentialIds(), autoRefreshSurfaces: false } }),
    });

    expect(result).toMatchObject({ scenarioId: "demo", provider: "claude", error: null, uiAnswers: 1, verdict: { pass: true, score: 1 } });
    expect(result.sessions).toBe(2);
    expect(result.evidence).toContain("Blue please");
    const judgeCall = judge.calls.find((c) => c.schemaName === "JudgeVerdict")!;
    expect(judgeCall.effort).toBe("high");
    expect(judgeCall.context[0]!.content).toContain("1. asked about color");
    expect(agent.calls.some((c) => c.schemaName === "SurfacePlan")).toBe(true);
    expect(markdownReport([result], "now")).toContain("| demo | ✅ · 1.00");
  });
});
