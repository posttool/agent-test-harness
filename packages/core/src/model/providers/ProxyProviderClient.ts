import { ModelErrorKindSchema } from "../../types/ModelErrorKind.ts";
import type { ProviderId } from "../../types/ProviderId.ts";
import { ModelError } from "../ModelError.ts";
import type { ProviderClient, ProviderRequest, ProviderResponse } from "../ProviderClient.ts";

/**
 * Calls a provider through the harness's key proxy (apps/web/server), so API keys never
 * reach the browser. Errors come back already normalized and are rethrown as ModelErrors.
 */
export class ProxyProviderClient implements ProviderClient {
  readonly provider: ProviderId;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(provider: ProviderId, baseUrl: string, fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.provider = provider;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const timeout = AbortSignal.timeout(request.timeoutMs + 5_000);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/model/${this.provider}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (timeout.aborted) throw new ModelError("timeout", "Proxy request timed out", { cause: error });
      throw new ModelError("network", error instanceof Error ? error.message : "Proxy unreachable", { cause: error });
    }
    const body = (await response.json().catch(() => ({}))) as { error?: { kind?: string; message?: string; retryAfterMs?: number | null } };
    if (response.ok) return body as unknown as ProviderResponse;
    const kind = ModelErrorKindSchema.safeParse(body.error?.kind);
    throw new ModelError(kind.success ? kind.data : "unknown", body.error?.message ?? `Proxy returned ${response.status}`, {
      status: response.status,
      retryAfterMs: body.error?.retryAfterMs ?? null,
    });
  }
}
