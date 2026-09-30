import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReplayProviderClient, type Recording } from "@harness/core";
import { runRecordedScenario, type ScenarioSignal } from "../src/index.ts";

// Replays a recorded live Claude run (scripts/record-scenario.ts). If prompts or capabilities
// change the calls the loop makes, this fails with "re-record the fixture".
const fixture = JSON.parse(readFileSync("fixtures/recordings/math-test-prep.json", "utf8")) as { start: string; recordings: Recording[] };
const input = JSON.parse(readFileSync("fixtures/recordings/math-test-prep.signals.json", "utf8")) as { signals: ScenarioSignal[] };

describe("recorded scenario: math test prep (PLAN.md M3)", () => {
  it("replays the recorded run and builds the test prep document", async () => {
    const client = new ReplayProviderClient("claude", fixture.recordings);
    const run = await runRecordedScenario({ client, start: fixture.start, signals: input.signals });

    expect(client.remaining).toBe(0);
    expect(run.sessions.every((s) => s.status === "ended")).toBe(true);

    const [topic] = await run.store.topics();
    expect(topic?.documentId).toBeTruthy();
    const doc = (await run.store.documents()).find((d) => d.id === topic!.documentId)!;
    const sectionKinds = doc.sections.map((s) => s.kind);
    expect(sectionKinds).toEqual(expect.arrayContaining(["progress", "actions", "dates", "observations"]));
    expect(JSON.stringify(doc.sections)).toContain("Substitution");
    expect(doc.revisionIds.length).toBeGreaterThan(1);

    const calendar = await run.store.calendar();
    expect(calendar.some((c) => c.start.startsWith("2026-05-26"))).toBe(true);
    expect(run.memory).toContain("Jerry");
  });
});
