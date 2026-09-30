import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { ContextBlockSchema, EffortLevelSchema, ModelError, ProviderIdSchema, type ProviderClient, type ProviderId } from "@harness/core";

/** Shape of a proxied request. Validated because it arrives over HTTP. */
const ProxyRequestSchema = z.object({
  model: z.string(),
  system: z.string(),
  context: z.array(ContextBlockSchema),
  schemaName: z.string(),
  jsonSchema: z.record(z.string(), z.unknown()),
  effort: EffortLevelSchema.nullable(),
  maxOutputTokens: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  serverFallback: z.boolean(),
});

const MAX_BODY_BYTES = 2_000_000;
const ROUTE_PREFIX = "/api/model/";

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * HTTP handler for `POST /api/model/:provider`. Runs the call with server-side keys and
 * returns the provider response, or `{error: {kind, message, retryAfterMs}}` with the
 * matching status so the browser's resting runner sees the same error classes.
 */
export function createModelProxy(clients: Partial<Record<ProviderId, ProviderClient>>) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? "";
    if (!url.startsWith(ROUTE_PREFIX)) return false;
    if (req.method !== "POST") {
      send(res, 405, { error: { kind: "bad_request", message: "Use POST" } });
      return true;
    }
    const provider = ProviderIdSchema.safeParse(url.slice(ROUTE_PREFIX.length));
    const client = provider.success ? clients[provider.data] : undefined;
    if (!client) {
      send(res, provider.success ? 401 : 404, {
        error: { kind: provider.success ? "auth" : "not_found", message: provider.success ? "No API key configured for this provider" : "Unknown provider" },
      });
      return true;
    }
    let parsed: z.infer<typeof ProxyRequestSchema>;
    try {
      parsed = ProxyRequestSchema.parse(JSON.parse(await readBody(req)));
    } catch (error) {
      send(res, 400, { error: { kind: "bad_request", message: error instanceof Error ? error.message : "Invalid request" } });
      return true;
    }
    try {
      send(res, 200, await client.generate(parsed));
    } catch (error) {
      if (error instanceof ModelError) {
        send(res, error.status ?? 502, { error: { kind: error.kind, message: error.message, retryAfterMs: error.retryAfterMs } });
      } else {
        send(res, 500, { error: { kind: "unknown", message: "Proxy error" } });
      }
    }
    return true;
  };
}
