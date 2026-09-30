/**
 * Plays part of a persona's day through the full runtime with no UI (PLAN.md M5):
 *
 *   node scripts/run-persona.ts [personaName] [virtualHours]
 *
 * Uses ANTHROPIC_API_KEY / GEMINI_API_KEY. Prints sessions, topics, documents and the
 * contextual brief at the end.
 */
import { createNodeRuntime } from "@harness/runtime/node";

const [name = "Jamie Lee", hours = "2"] = process.argv.slice(2);
const rt = await createNodeRuntime({ root: process.cwd(), overrides: { autoRefreshSurfaces: false } });
const persona = (await rt.snapshot()).persona.personas.find((p) => p.name === name);
if (!persona) throw new Error(`No persona named ${name}`);
await rt.handle({ type: "persona_start", personaId: persona.id });
const start = rt.clock.now();
const end = start + Number(hours) * 3_600_000;
let cost = 0;
rt.traces.subscribe((t) => {
  const usage = (t.data.usage ?? null) as { costUsd?: number | null } | null;
  cost += usage?.costUsd ?? 0;
  if (t.kind === "session_ended" || t.kind === "session_paused" || t.kind === "error") {
    console.log(`${new Date(rt.clock.now()).toISOString().slice(11, 16)} ${t.kind}: ${JSON.stringify(t.data).slice(0, 220)}`);
  }
});
while (rt.clock.now() < end) {
  await rt.tick(1_000); // one virtual minute at the persona speed of 60x
  await rt.idle();
}
rt.bridge.flush(true);
await rt.idle();
await rt.device.refresh(rt.now());
const snap = await rt.snapshot();
console.log("\n== sessions");
for (const s of snap.sessions) console.log(`- ${s.title} [${s.status}] ${s.summary ?? s.error ?? ""}`.slice(0, 240));
console.log("\n== topics");
for (const t of snap.memory.topics) console.log(`- ${t.title} (${t.category}, ${t.stage})${t.parentId ? " [child]" : ""}: ${t.meta.summary}`.slice(0, 240));
console.log("\n== documents");
for (const d of snap.memory.documents) console.log(`- ${d.title}: ${d.sections.map((s) => s.title).join(" / ")}`);
console.log("\n== brief");
for (const b of snap.device.brief) console.log(`- ${b.component.title}: ${b.reason}`);
console.log(`\nnodes ${snap.memory.nodes.length}, edges ${snap.memory.edges.length}, model cost about $${cost.toFixed(2)} (Claude only)`);
