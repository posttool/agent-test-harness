import type { AmbientSource } from "../types/AmbientSource.ts";
import type { PersonaObservation } from "../types/PersonaObservation.ts";
import { randomIds, type IdGenerator } from "../util/ids.ts";

const seconds = (time: string) => {
  const [h = "0", m = "0", s = "0"] = time.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
};

/** How one observation reads as an ambient event. Formatting only; the model interprets it. */
export function describeObservation(o: PersonaObservation): string {
  const who = [o.senderApp, o.sender].filter(Boolean).join(" · ");
  return `${o.device ?? "device"} ${o.type ?? "observation"}${who ? ` (${who})` : ""}: ${o.data}`;
}

/** A persona's day as one scripted ambient source, plus the virtual time the day starts. */
export function personaDaySource(persona: { id: string; name: string }, date: string, observations: PersonaObservation[], ids: IdGenerator = randomIds): { source: AmbientSource; startsAt: number } {
  const sorted = [...observations].sort((a, b) => a.time.localeCompare(b.time));
  const first = sorted[0] ? seconds(sorted[0].time) : 0;
  const startsAt = Date.parse(`${date}T${sorted[0]?.time ?? "00:00:00"}`);
  return {
    startsAt: Number.isNaN(startsAt) ? 0 : startsAt,
    source: {
      id: ids.next("source"),
      kind: "custom",
      name: `${persona.name}, ${date}`,
      templateId: `persona:${persona.id}`,
      ratePerMinute: 0,
      speed: 1,
      enabled: true,
      startedAt: null,
      cursor: 0,
      lifecycle: "until_complete",
      ownerSubscriptionId: null,
      definition: {
        description: `A day in the life of ${persona.name} (Aura persona ${persona.id})`,
        events: sorted.map((o) => ({ offsetSeconds: seconds(o.time) - first, kind: "custom", content: describeObservation(o), status: "info" })),
      },
    },
  };
}

/** A short description of the persona for grounding simulated streams. */
export function personaBrief(persona: Record<string, unknown>): string {
  const pick = (k: string) => (persona[k] === undefined || persona[k] === null ? null : `${k}: ${JSON.stringify(persona[k])}`);
  return ["name", "age", "occupation", "city", "family", "friends", "hobbies", "goals_this_week", "apps_and_services"].map(pick).filter(Boolean).join("\n");
}
