import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AmbientTemplate } from "../ambient/AmbientFactory.ts";
import type { PersonaFixtureData } from "../persona/PersonaSource.ts";
import { PersonaDayRefSchema } from "../types/PersonaDayRef.ts";
import { PersonaObservationSchema } from "../types/PersonaObservation.ts";
import { PersonaSummarySchema } from "../types/PersonaSummary.ts";

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Loads fixtures/personas (written by scripts/extract-persona-export.ts). */
export function loadPersonaFixtures(dir: string): PersonaFixtureData {
  const data: PersonaFixtureData = { personas: [], details: {}, days: {}, observations: {} };
  if (!existsSync(join(dir, "index.json"))) return data;
  data.personas = (readJson(join(dir, "index.json")) as unknown[]).map((p) => PersonaSummarySchema.parse(p));
  for (const persona of data.personas) {
    const base = join(dir, persona.id);
    data.details[persona.id] = readJson(join(base, "persona.json")) as Record<string, unknown>;
    data.days[persona.id] = (readJson(join(base, "days.json")) as unknown[]).map((d) => PersonaDayRefSchema.parse(d));
    for (const file of readdirSync(join(base, "observations"))) {
      const date = file.replace(".json", "");
      data.observations[`${persona.id}/${date}`] = (readJson(join(base, "observations", file)) as unknown[]).map((o) => PersonaObservationSchema.parse(o));
    }
  }
  return data;
}

/** Loads samples/ambient/*.json. */
export function loadAmbientTemplates(dir: string): AmbientTemplate[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson(join(dir, f)) as AmbientTemplate);
}
