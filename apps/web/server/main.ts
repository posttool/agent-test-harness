import { createServer } from "node:http";
import { ClaudeClient, GeminiClient, type ProviderClient, type ProviderId } from "@harness/core";
import { createModelProxy } from "./modelProxy.ts";

// Dev server for the harness. Keys come from the environment and never leave this process.
const clients: Partial<Record<ProviderId, ProviderClient>> = {};
if (process.env.ANTHROPIC_API_KEY) clients.claude = new ClaudeClient();
if (process.env.GEMINI_API_KEY) clients.gemini = new GeminiClient();

const proxy = createModelProxy(clients);
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

createServer((req, res) => {
  proxy(req, res).then((handled) => {
    if (!handled) res.writeHead(404, { "content-type": "application/json" }).end('{"error":{"kind":"not_found","message":"Not found"}}');
  });
}).listen(port, host, () => {
  console.log(`harness server on http://${host}:${port} (providers: ${Object.keys(clients).join(", ") || "none"})`);
});
