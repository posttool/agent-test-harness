import type { ProviderId } from "../types/ProviderId.ts";
import type { ProviderClient, ProviderRequest, ProviderResponse } from "./ProviderClient.ts";

/** One recorded call. Replay matches calls in order, by schema name. */
export interface Recording {
  provider: ProviderId;
  model: string;
  schemaName: string;
  response: ProviderResponse;
}

/** Wraps a live client and keeps every successful response, so tests can replay real runs. */
export class RecordingProviderClient implements ProviderClient {
  readonly provider: ProviderId;
  readonly recordings: Recording[] = [];
  private readonly inner: ProviderClient;

  constructor(inner: ProviderClient) {
    this.inner = inner;
    this.provider = inner.provider;
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const response = await this.inner.generate(request, signal);
    this.recordings.push({ provider: this.provider, model: request.model, schemaName: request.schemaName, response });
    return response;
  }
}

/**
 * Replays recorded responses in order. Each request must ask for the schema the next
 * recording answered; anything else fails loudly, which means the recording is stale.
 */
export class ReplayProviderClient implements ProviderClient {
  readonly provider: ProviderId;
  readonly calls: ProviderRequest[] = [];
  private readonly queue: Recording[];

  constructor(provider: ProviderId, recordings: readonly Recording[]) {
    this.provider = provider;
    this.queue = recordings.filter((r) => r.provider === provider);
  }

  get remaining(): number {
    return this.queue.length;
  }

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error(`Replay ran out of recordings at ${request.schemaName}; re-record the fixture`);
    if (next.schemaName !== request.schemaName) {
      throw new Error(`Replay expected a ${next.schemaName} call but got ${request.schemaName}; re-record the fixture`);
    }
    return next.response;
  }
}
