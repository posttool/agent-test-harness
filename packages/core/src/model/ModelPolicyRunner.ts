import type { z } from "zod";
import type { ContextBlock } from "../types/ContextBlock.ts";
import type { ModelAttempt } from "../types/ModelAttempt.ts";
import type { ModelPolicy } from "../types/ModelPolicy.ts";
import type { ModelRef } from "../types/ModelRef.ts";
import type { ModelRole } from "../types/ModelRole.ts";
import type { ProviderId } from "../types/ProviderId.ts";
import type { Usage } from "../types/Usage.ts";
import { systemClock, type Clock } from "../util/clock.ts";
import { toProviderJsonSchema, type JsonSchema } from "./jsonSchema.ts";
import { ModelError, TRANSIENT_KINDS } from "./ModelError.ts";
import type { ProviderClient } from "./ProviderClient.ts";
import { RestRegistry, type RestChange } from "./RestRegistry.ts";

export interface StructuredCall<T> {
  role: ModelRole;
  schemaName: string;
  schema: z.ZodType<T>;
  system: string;
  context: ContextBlock[];
  signal?: AbortSignal;
}

export interface StructuredResult<T> {
  value: T;
  provider: ProviderId;
  model: string;
  usage: Usage;
  attempts: ModelAttempt[];
}

/** Every model in the chain failed, or the step budget ran out. */
export class ModelChainError extends Error {
  readonly attempts: ModelAttempt[];
  readonly budgetExceeded: boolean;

  constructor(message: string, attempts: ModelAttempt[], budgetExceeded: boolean) {
    super(message);
    this.name = "ModelChainError";
    this.attempts = attempts;
    this.budgetExceeded = budgetExceeded;
  }
}

export interface RunnerOptions {
  clients: Partial<Record<ProviderId, ProviderClient>>;
  policy: ModelPolicy;
  rests?: RestRegistry;
  clock?: Clock;
  random?: () => number;
  onAttempt?: (attempt: ModelAttempt) => void;
  onRest?: (change: RestChange) => void;
}

const keyOf = (ref: ModelRef) => `${ref.provider}:${ref.model}`;

/**
 * Runs structured model calls under the resting strategy (PLAN.md section 4.5): back off
 * and retry the same model, rest a model that keeps failing, then fall back down a chain
 * that can cross providers.
 */
export class ModelPolicyRunner {
  private policy: ModelPolicy;
  private readonly clients: Partial<Record<ProviderId, ProviderClient>>;
  private readonly clock: Clock;
  private readonly random: () => number;
  private readonly disabledProviders = new Set<ProviderId>();
  private readonly schemaCache = new WeakMap<z.ZodType, JsonSchema>();
  readonly rests: RestRegistry;
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions) {
    this.options = options;
    this.policy = options.policy;
    this.clients = options.clients;
    this.rests = options.rests ?? new RestRegistry();
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
  }

  setPolicy(policy: ModelPolicy): void {
    this.policy = policy;
  }

  getPolicy(): ModelPolicy {
    return this.policy;
  }

  /** Providers skipped for the rest of the session after an auth failure. */
  get disabled(): ReadonlySet<ProviderId> {
    return this.disabledProviders;
  }

  chainFor(role: ModelRole): ModelRef[] {
    const override = this.policy.roles[role];
    const chain = [override?.primary ?? this.policy.primary, ...(override?.fallbacks ?? this.policy.fallbacks)];
    const seen = new Set<string>();
    return chain.filter((ref) => (seen.has(keyOf(ref)) ? false : (seen.add(keyOf(ref)), true)));
  }

  async run<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
    const resting = this.policy.resting;
    const deadline = this.clock.now() + resting.stepBudgetMs;
    const jsonSchema = this.jsonSchemaFor(call.schema);
    const attempts: ModelAttempt[] = [];
    const record = (a: ModelAttempt) => {
      attempts.push(a);
      this.options.onAttempt?.(a);
    };

    for (const ref of this.chainFor(call.role)) {
      const key = keyOf(ref);
      const client = this.clients[ref.provider];
      if (!client || this.disabledProviders.has(ref.provider)) {
        record(this.attempt(call.role, ref, 0, "skipped_auth", null, client ? "provider disabled after an auth error" : "no client configured", 0, 0, null));
        continue;
      }
      const availability = this.rests.acquire(key, this.clock.now());
      if (availability === "resting") {
        record(this.attempt(call.role, ref, 0, "skipped_resting", null, "model is resting", 0, 0, null));
        continue;
      }
      const isProbe = availability === "probe";
      const maxTransient = isProbe ? 1 : resting.maxAttempts;
      let transientFailures = 0;
      let schemaRetriesLeft = resting.schemaRetries;
      let extraContext: ContextBlock[] = [];
      let delayBefore = 0;
      let attemptNo = 0;
      let verdict: "exhausted" | "moved_on" = "moved_on";

      while (true) {
        const remaining = deadline - this.clock.now();
        if (remaining <= 0) {
          if (isProbe) this.rests.releaseProbe(key);
          throw new ModelChainError(`Step budget of ${resting.stepBudgetMs} ms ran out`, attempts, true);
        }
        attemptNo++;
        const started = this.clock.now();
        try {
          const response = await client.generate(
            {
              model: ref.model,
              system: call.system,
              context: [...call.context, ...extraContext],
              schemaName: call.schemaName,
              jsonSchema,
              effort: ref.provider === "claude" ? this.policy.effort[call.role] : null,
              maxOutputTokens: this.policy.maxOutputTokens,
              timeoutMs: Math.min(this.policy.timeoutMs, remaining),
              serverFallback: ref.serverFallback,
            },
            call.signal,
          );
          const latency = this.clock.now() - started;
          const parsed = parseAndValidate(response.text, call.schema);
          if (!parsed.ok) {
            record(this.attempt(call.role, ref, attemptNo, "error", "schema_invalid", parsed.error, delayBefore, latency, response.usage));
            if (schemaRetriesLeft > 0) {
              schemaRetriesLeft--;
              delayBefore = 0;
              extraContext = [
                {
                  kind: "error",
                  title: "Your previous output did not match the schema",
                  content: `${parsed.error}\nReturn JSON that matches the ${call.schemaName} schema exactly.`,
                },
              ];
              continue;
            }
            break;
          }
          record(this.attempt(call.role, ref, attemptNo, "ok", null, null, delayBefore, latency, response.usage));
          this.rests.recordSuccess(key);
          return { value: parsed.value, provider: ref.provider, model: response.servedBy, usage: response.usage, attempts };
        } catch (error) {
          if (!(error instanceof ModelError)) {
            if (isProbe) this.rests.releaseProbe(key);
            throw error;
          }
          const latency = this.clock.now() - started;
          record(this.attempt(call.role, ref, attemptNo, "error", error.kind, error.message, delayBefore, latency, null));

          if (error.kind === "auth") {
            this.disabledProviders.add(ref.provider);
            break;
          }
          if (error.kind === "max_tokens" && schemaRetriesLeft > 0) {
            schemaRetriesLeft--;
            delayBefore = 0;
            continue;
          }
          if (!TRANSIENT_KINDS.has(error.kind)) break;

          transientFailures++;
          if (transientFailures >= maxTransient) {
            verdict = "exhausted";
            break;
          }
          const delay = error.retryAfterMs ?? this.backoff(transientFailures);
          if (this.clock.now() + delay >= deadline) break;
          delayBefore = delay;
          await this.clock.sleep(delay, call.signal);
        }
      }

      if (verdict === "exhausted") {
        const change = this.rests.recordExhausted(key, this.clock.now(), resting);
        if (change) this.options.onRest?.(change);
      } else if (isProbe) {
        this.rests.releaseProbe(key);
      }
    }
    throw new ModelChainError(`Every model in the ${call.role} chain failed`, attempts, false);
  }

  /** Exponential backoff with full jitter. */
  private backoff(failures: number): number {
    const r = this.policy.resting;
    const ceiling = Math.min(r.maxDelayMs, r.baseDelayMs * r.factor ** (failures - 1));
    return Math.floor(this.random() * ceiling);
  }

  private jsonSchemaFor(schema: z.ZodType): JsonSchema {
    let json = this.schemaCache.get(schema);
    if (!json) {
      json = toProviderJsonSchema(schema);
      this.schemaCache.set(schema, json);
    }
    return json;
  }

  private attempt(
    role: ModelRole,
    ref: ModelRef,
    attempt: number,
    outcome: ModelAttempt["outcome"],
    errorKind: ModelAttempt["errorKind"],
    errorMessage: string | null,
    delayBeforeMs: number,
    latencyMs: number,
    usage: Usage | null,
  ): ModelAttempt {
    return { role, provider: ref.provider, model: ref.model, attempt, outcome, errorKind, errorMessage, delayBeforeMs, latencyMs, usage };
  }
}

function parseAndValidate<T>(text: string, schema: z.ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "Output was not valid JSON." };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}
