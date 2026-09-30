import type { RestingPolicy } from "../types/RestingPolicy.ts";

interface RestState {
  /** Times of recent failures that exhausted retries, inside the failure window. */
  failures: number[];
  restUntil: number | null;
  restMs: number;
  probing: boolean;
}

export type Availability = "ok" | "resting" | "probe";

export interface RestChange {
  key: string;
  restMs: number;
  restUntil: number;
  reason: "failures" | "probe_failed";
}

/**
 * Rest state for every model, shared by all sessions so one struggling model does not
 * slow every loop (PLAN.md section 4.5, "Resting a model").
 */
export class RestRegistry {
  private states = new Map<string, RestState>();

  private state(key: string): RestState {
    let s = this.states.get(key);
    if (!s) {
      s = { failures: [], restUntil: null, restMs: 0, probing: false };
      this.states.set(key, s);
    }
    return s;
  }

  /** Whether a model can be called now. After a rest ends, exactly one caller gets a probe. */
  acquire(key: string, now: number): Availability {
    const s = this.state(key);
    if (s.restUntil === null) return "ok";
    if (now < s.restUntil || s.probing) return "resting";
    s.probing = true;
    return "probe";
  }

  recordSuccess(key: string): void {
    const s = this.state(key);
    s.failures = [];
    s.restUntil = null;
    s.restMs = 0;
    s.probing = false;
  }

  /** Records a failure that exhausted retries. Returns the new rest, if one started. */
  recordExhausted(key: string, now: number, policy: RestingPolicy): RestChange | null {
    const s = this.state(key);
    if (s.probing) {
      s.probing = false;
      s.restMs = Math.min(Math.max(s.restMs, policy.restMs) * 2, policy.maxRestMs);
      s.restUntil = now + s.restMs;
      return { key, restMs: s.restMs, restUntil: s.restUntil, reason: "probe_failed" };
    }
    s.failures = [...s.failures.filter((t) => now - t < policy.failureWindowMs), now];
    if (s.failures.length < policy.restAfterFailures) return null;
    s.failures = [];
    s.restMs = policy.restMs;
    s.restUntil = now + s.restMs;
    return { key, restMs: s.restMs, restUntil: s.restUntil, reason: "failures" };
  }

  /** Releases a probe that ended without a verdict (e.g. a refusal). */
  releaseProbe(key: string): void {
    this.state(key).probing = false;
  }

  snapshot(now: number): Record<string, { resting: boolean; restUntil: number | null; recentFailures: number }> {
    return Object.fromEntries(
      [...this.states].map(([key, s]) => [
        key,
        { resting: s.restUntil !== null && now < s.restUntil, restUntil: s.restUntil, recentFailures: s.failures.length },
      ]),
    );
  }
}
