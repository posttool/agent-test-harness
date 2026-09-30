import type { ContextBlock } from "../types/ContextBlock.ts";
import type { EffortLevel } from "../types/EffortLevel.ts";
import type { ProviderId } from "../types/ProviderId.ts";
import type { Usage } from "../types/Usage.ts";
import type { JsonSchema } from "./jsonSchema.ts";

export interface ProviderRequest {
  model: string;
  /** Stable instructions; providers cache this prefix. */
  system: string;
  /** Per-call working context, rendered after the system prompt. */
  context: ContextBlock[];
  schemaName: string;
  jsonSchema: JsonSchema;
  effort: EffortLevel | null;
  maxOutputTokens: number;
  timeoutMs: number;
  serverFallback: boolean;
}

export interface ProviderResponse {
  /** The raw JSON text the model produced. The runner parses and validates it. */
  text: string;
  usage: Usage;
  /** The model that actually served the call (may differ after a server-side fallback). */
  servedBy: string;
}

/**
 * One provider behind one interface. Implementations throw ModelError for every failure,
 * including refusals and truncated output, and never retry on their own.
 */
export interface ProviderClient {
  readonly provider: ProviderId;
  generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}
