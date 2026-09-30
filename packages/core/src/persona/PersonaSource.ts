import { z } from "zod";
import { PersonaDayRefSchema, type PersonaDayRef } from "../types/PersonaDayRef.ts";
import { PersonaObservationSchema, type PersonaObservation } from "../types/PersonaObservation.ts";
import { PersonaSummarySchema, type PersonaSummary } from "../types/PersonaSummary.ts";

/** Aura persona data (PLAN.md section 7, persona service contract). */
export interface PersonaSource {
  readonly name: string;
  listPersonas(): Promise<PersonaSummary[]>;
  getPersona(id: string): Promise<Record<string, unknown>>;
  listDays(id: string): Promise<PersonaDayRef[]>;
  listObservations(id: string, date: string): Promise<PersonaObservation[]>;
}

/** The deployed persona service's HTTP endpoints. Responses are validated as data. */
export class HttpPersonaSource implements PersonaSource {
  readonly name = "persona service";
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    this.fetchImpl = fetchImpl;
  }

  private async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Persona service ${path} returned ${response.status}`);
    return schema.parse(await response.json());
  }

  listPersonas() {
    return this.get("listPersona1", z.array(PersonaSummarySchema));
  }
  getPersona(id: string) {
    return this.get(`getPersona1?id=${encodeURIComponent(id)}`, z.record(z.string(), z.unknown()));
  }
  listDays(id: string) {
    return this.get(`listDaysForPersona1?id=${encodeURIComponent(id)}`, z.array(PersonaDayRefSchema));
  }
  /** `listObservations1` returns `{}` until the missing `await` is fixed upstream; that fails validation here. */
  listObservations(id: string, date: string) {
    return this.get(`listObservations1?id=${encodeURIComponent(id)}&date=${encodeURIComponent(date)}`, z.array(PersonaObservationSchema));
  }
}

export interface PersonaFixtureData {
  personas: PersonaSummary[];
  details: Record<string, Record<string, unknown>>;
  days: Record<string, PersonaDayRef[]>;
  /** Keyed `${personaId}/${date}`. */
  observations: Record<string, PersonaObservation[]>;
}

/** Exported persona data (fixtures/personas), used when the service is unreachable. */
export class StaticPersonaSource implements PersonaSource {
  readonly name = "persona fixtures";
  private readonly data: PersonaFixtureData;

  constructor(data: PersonaFixtureData) {
    this.data = data;
  }

  async listPersonas() {
    return this.data.personas;
  }
  async getPersona(id: string) {
    const persona = this.data.details[id];
    if (!persona) throw new Error(`No persona ${id}`);
    return persona;
  }
  async listDays(id: string) {
    return this.data.days[id] ?? [];
  }
  async listObservations(id: string, date: string) {
    return this.data.observations[`${id}/${date}`] ?? [];
  }
}

/** Tries the live service and falls back to fixtures, per call. */
export class FallbackPersonaSource implements PersonaSource {
  private readonly primary: PersonaSource;
  private readonly fallback: PersonaSource;
  lastUsed: string;

  constructor(primary: PersonaSource, fallback: PersonaSource) {
    this.primary = primary;
    this.fallback = fallback;
    this.lastUsed = fallback.name;
  }

  get name(): string {
    return `${this.primary.name}, else ${this.fallback.name}`;
  }

  private async either<T>(call: (s: PersonaSource) => Promise<T>): Promise<T> {
    try {
      const result = await call(this.primary);
      this.lastUsed = this.primary.name;
      return result;
    } catch {
      this.lastUsed = this.fallback.name;
      return call(this.fallback);
    }
  }

  listPersonas() {
    return this.either((s) => s.listPersonas());
  }
  getPersona(id: string) {
    return this.either((s) => s.getPersona(id));
  }
  listDays(id: string) {
    return this.either((s) => s.listDays(id));
  }
  listObservations(id: string, date: string) {
    return this.either(async (s) => {
      const obs = await s.listObservations(id, date);
      if (!obs.length) throw new Error("no observations");
      return obs;
    });
  }
}
