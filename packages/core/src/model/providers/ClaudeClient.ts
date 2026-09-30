import Anthropic from "@anthropic-ai/sdk";
import type { Clock } from "../../util/clock.ts";
import { systemClock } from "../../util/clock.ts";
import { kindForStatus, ModelError, parseRetryAfter } from "../ModelError.ts";
import { costUsd } from "../pricing.ts";
import type { ProviderClient, ProviderRequest, ProviderResponse } from "../ProviderClient.ts";
import { renderContext } from "../renderContext.ts";

const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface ClaudeClientOptions {
  apiKey?: string;
  baseURL?: string;
  clock?: Clock;
}

/**
 * Claude through the Messages API. Structured output via `output_config.format`, effort via
 * `output_config.effort`, the stable system prompt cached with `cache_control`, and
 * server-side refusal fallback (`fallbacks: "default"`) when the model ref asks for it.
 * SDK retries are off: ModelPolicyRunner owns retries and resting.
 */
export class ClaudeClient implements ProviderClient {
  readonly provider = "claude" as const;
  private readonly client: Anthropic;
  private readonly clock: Clock;

  constructor(options: ClaudeClientOptions = {}) {
    this.client = new Anthropic({
      maxRetries: 0,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    });
    this.clock = options.clock ?? systemClock;
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create(
        {
          model: request.model,
          max_tokens: request.maxOutputTokens,
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: renderContext(request.context) }],
          output_config: {
            format: { type: "json_schema", schema: request.jsonSchema },
            ...(request.effort ? { effort: request.effort } : {}),
          },
          ...(request.serverFallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const } : {}),
        },
        { timeout: request.timeoutMs, maxRetries: 0, ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      throw this.mapError(error);
    }

    if (message.stop_reason === "refusal") {
      const category = message.stop_details && "category" in message.stop_details ? message.stop_details.category : null;
      throw new ModelError("refusal", `Claude declined the request${category ? ` (${category})` : ""}`);
    }
    if (message.stop_reason === "max_tokens") throw new ModelError("max_tokens", "Output hit max_tokens before finishing");
    if (message.stop_reason === "model_context_window_exceeded") throw new ModelError("bad_request", "Context window exceeded");

    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    return { text, usage: { ...usage, costUsd: costUsd(message.model, usage) }, servedBy: message.model };
  }

  private mapError(error: unknown): unknown {
    if (error instanceof Anthropic.APIUserAbortError) return error;
    if (error instanceof Anthropic.APIConnectionTimeoutError) return new ModelError("timeout", error.message, { cause: error });
    if (error instanceof Anthropic.APIConnectionError) return new ModelError("network", error.message, { cause: error });
    if (error instanceof Anthropic.APIError && typeof error.status === "number") {
      return new ModelError(kindForStatus(error.status), error.message, {
        status: error.status,
        retryAfterMs: parseRetryAfter(error.headers, this.clock.now()),
        cause: error,
      });
    }
    return error;
  }
}
