/**
 * Records a live run of the reasoning loop so tests can replay it without the network:
 *
 *   node scripts/record-scenario.ts math-test-prep
 *
 * Reads fixtures/recordings/<name>.signals.json and writes fixtures/recordings/<name>.json
 * (the signals actually sent, including UI answers, plus every model response).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { ClaudeClient, RecordingProviderClient } from "@harness/core";
import { runRecordedScenario, type ScenarioSignal } from "../packages/capabilities/src/scenario.ts";

const name = process.argv[2];
if (!name) throw new Error("usage: record-scenario.ts <name>");
const input = JSON.parse(readFileSync(`fixtures/recordings/${name}.signals.json`, "utf8")) as { start: string; signals: ScenarioSignal[] };
const recorder = new RecordingProviderClient(new ClaudeClient());
const run = await runRecordedScenario({ client: recorder, start: input.start, signals: input.signals });
writeFileSync(`fixtures/recordings/${name}.json`, JSON.stringify({ start: input.start, sent: run.sent, recordings: recorder.recordings }, null, 2));
console.log(`recorded ${recorder.recordings.length} calls; sessions:`, run.sessions.map((s) => `${s.title} [${s.status}]`));
console.log(run.memory);
