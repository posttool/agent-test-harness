import { ApiError, FinishReason, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { kindForStatus, ModelError } from "../ModelError.ts";
import type { ProviderClient, ProviderRequest, ProviderResponse } from "../ProviderClient.ts";
import { renderContext } from "../renderContext.ts";

const REFUSAL_REASONS: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.SPII,
  FinishReason.RECITATION,
]);

export interface GeminiClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Gemini through `@google/genai`. Structured output via `responseJsonSchema`. The SDK's own
 * retries are off (`attempts: 1`): ModelPolicyRunner owns retries and resting.
 */
export class GeminiClient implements ProviderClient {
  readonly provider = "gemini" as const;
  private readonly ai: GoogleGenAI;

  constructor(options: GeminiClientOptions = {}) {
    const apiKey = options.apiKey ?? (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEMINI_API_KEY;
    this.ai = new GoogleGenAI({
      ...(apiKey ? { apiKey } : {}),
      httpOptions: { retryOptions: { attempts: 1 }, ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) },
    });
  }

  async generate(request: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    let response: GenerateContentResponse;
    try {
      response = await this.ai.models.generateContent({
        model: request.model,
        contents: [{ role: "user", parts: [{ text: renderContext(request.context) }] }],
        config: {
          systemInstruction: request.system,
          responseMimeType: "application/json",
          responseJsonSchema: request.jsonSchema,
          maxOutputTokens: request.maxOutputTokens,
          httpOptions: { timeout: request.timeoutMs, retryOptions: { attempts: 1 } },
          ...(signal ? { abortSignal: signal } : {}),
        },
      });
    } catch (error) {
      throw this.mapError(error, signal);
    }

    if (response.promptFeedback?.blockReason) {
      throw new ModelError("refusal", `Gemini blocked the prompt (${response.promptFeedback.blockReason})`);
    }
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && REFUSAL_REASONS.has(finish)) throw new ModelError("refusal", `Gemini stopped with ${finish}`);
    if (finish === FinishReason.MAX_TOKENS) throw new ModelError("max_tokens", "Output hit maxOutputTokens before finishing");

    const meta = response.usageMetadata;
    return {
      text: response.text ?? "",
      usage: {
        inputTokens: meta?.promptTokenCount ?? 0,
        outputTokens: (meta?.candidatesTokenCount ?? 0) + (meta?.thoughtsTokenCount ?? 0),
        cacheReadTokens: meta?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
        costUsd: null,
      },
      servedBy: response.modelVersion ?? request.model,
    };
  }

  private mapError(error: unknown, signal?: AbortSignal): unknown {
    if (signal?.aborted) return error;
    if (error instanceof ApiError) return new ModelError(kindForStatus(error.status), error.message, { status: error.status, cause: error });
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return new ModelError("timeout", error.message, { cause: error });
    }
    if (error instanceof TypeError) return new ModelError("network", error.message, { cause: error });
    return error;
  }
}
