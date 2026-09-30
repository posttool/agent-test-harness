import type { ModelErrorKind } from "../types/ModelErrorKind.ts";

/** A provider failure, normalized so the resting runner treats every provider alike. */
export class ModelError extends Error {
  readonly kind: ModelErrorKind;
  readonly retryAfterMs: number | null;
  readonly status: number | null;

  constructor(kind: ModelErrorKind, message: string, options: { retryAfterMs?: number | null; status?: number | null; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = "ModelError";
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
  }
}

/** Errors worth retrying on the same model after a backoff. */
export const TRANSIENT_KINDS: ReadonlySet<ModelErrorKind> = new Set(["rate_limit", "overloaded", "server", "timeout", "network"]);

/** Maps an HTTP status to an error kind. Shared by the provider adapters. */
export function kindForStatus(status: number): ModelErrorKind {
  if (status === 429) return "rate_limit";
  if (status === 529) return "overloaded";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 408) return "timeout";
  if (status === 409 || status >= 500) return "server";
  if (status >= 400) return "bad_request";
  return "unknown";
}

/** Reads `retry-after-ms` or `retry-after` (seconds or an HTTP date). */
export function parseRetryAfter(headers: { get(name: string): string | null } | undefined, now: number): number | null {
  if (!headers) return null;
  const ms = headers.get("retry-after-ms");
  if (ms !== null && Number.isFinite(Number(ms))) return Math.max(0, Number(ms));
  const value = headers.get("retry-after");
  if (value === null) return null;
  if (Number.isFinite(Number(value))) return Math.max(0, Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}
