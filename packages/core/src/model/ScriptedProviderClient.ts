import type { ProviderId } from "../types/ProviderId.ts";
import type { Usage } from "../types/Usage.ts";
import type { Clock } from "../util/clock.ts";
import { ModelError } from "./ModelError.ts";
import type { ProviderClient, ProviderRequest, ProviderResponse } from "./ProviderClient.ts";

/** One scripted reply: a value to return as JSON, raw text, an error, or a function of the request. */
export type ScriptedReply =
  | { value: unknown; latencyMs?: number }
  | { text: string; latencyMs?: number }
  | { error: ModelError; latencyMs?: number }
  | ((request: ProviderRequest) => ScriptedReply);

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: null };

/**
 * A provider that replies from a script instead of the network. Replies are queued per
 * model (or under "*" for any model) and consumed in order. Every request is recorded.
 */
export class ScriptedProviderClient implements ProviderClient {
  readonly calls: ProviderRequest[] = [];
  private readonly queues = new Map<string, ScriptedReply[]>();
  /** Answers any request that has no queued reply. */
  handler: ((request: ProviderRequest) => ScriptedReply) | null = null;

  readonly provider: ProviderId;
  private readonly clock: Clock | undefined;

  constructor(provider: ProviderId, clock?: Clock) {
    this.provider = provider;
    this.clock = clock;
  }

  /** Queues replies for a model id, or "*" for any model. */
  script(model: string, ...replies: ScriptedReply[]): this {
    this.queues.set(model, [...(this.queues.get(model) ?? []), ...replies]);
    return this;
  }

  remaining(model = "*"): number {
    return this.queues.get(model)?.length ?? 0;
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    const queue = this.queues.get(request.model)?.length ? this.queues.get(request.model)! : this.queues.get("*");
    let reply = queue?.shift() ?? this.handler ?? undefined;
    if (reply === undefined) {
      throw new Error(`ScriptedProviderClient(${this.provider}): no reply scripted for ${request.model} (${request.schemaName})`);
    }
    while (typeof reply === "function") reply = reply(request);
    if (reply.latencyMs && this.clock) await this.clock.sleep(reply.latencyMs);
    if ("error" in reply) throw reply.error;
    const text = "text" in reply ? reply.text : JSON.stringify(reply.value);
    return { text, usage: ZERO_USAGE, servedBy: request.model };
  }
}

export const scriptedError = (kind: ModelError["kind"], retryAfterMs: number | null = null) => ({
  error: new ModelError(kind, `scripted ${kind}`, { retryAfterMs }),
});
