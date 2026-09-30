import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema, type ProviderClient, type ProviderId, type ServerMessage } from "@harness/core";
import type { HarnessRuntime } from "@harness/runtime";
import { createModelProxy } from "./modelProxy.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

export interface HarnessServerOptions {
  runtime: HarnessRuntime;
  /** Built UI (apps/web/dist); omitted in dev, where Vite serves the UI. */
  staticDir?: string;
  clients?: Partial<Record<ProviderId, ProviderClient>>;
}

/**
 * One runtime, many clients (PLAN.md M9): every browser tab or phone that connects to /ws
 * gets the same live snapshot and traces, and its commands drive the same agent.
 */
export function createHarnessServer(options: HarnessServerOptions): { server: Server; wss: WebSocketServer } {
  const { runtime } = options;
  const proxy = createModelProxy(options.clients ?? {});
  const server = createServer((req, res) => {
    void proxy(req, res).then((handled) => {
      if (handled) return;
      if (!options.staticDir) return void res.writeHead(404).end("Not found");
      const path = (req.url ?? "/").split("?")[0]!;
      const file = normalize(join(options.staticDir, path === "/" ? "index.html" : path));
      if (!file.startsWith(options.staticDir) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("Not found");
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
    });
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const broadcast = (message: ServerMessage) => {
    const text = JSON.stringify(message);
    for (const ws of wss.clients) if (ws.readyState === ws.OPEN) ws.send(text);
  };
  const pushSnapshot = async () => broadcast({ type: "snapshot", snapshot: await runtime.snapshot() });

  runtime.onChange(() => void pushSnapshot());
  runtime.onTraces((entries, reset) => broadcast({ type: "traces", entries, reset }));

  wss.on("connection", async (ws) => {
    runtime.clientCount = wss.clients.size;
    send(ws, { type: "traces", entries: runtime.traces.list(), reset: true });
    send(ws, { type: "snapshot", snapshot: await runtime.snapshot() });
    void pushSnapshot();
    ws.on("close", () => {
      runtime.clientCount = wss.clients.size;
      void pushSnapshot();
    });
    ws.on("message", (data) => {
      let parsed;
      try {
        parsed = ClientMessageSchema.parse(JSON.parse(String(data)));
      } catch (error) {
        return send(ws, { type: "error", message: `Bad command: ${error instanceof Error ? error.message : String(error)}` });
      }
      runtime.handle(parsed).catch((error: unknown) => send(ws, { type: "error", message: error instanceof Error ? error.message : String(error) }));
    });
  });
  return { server, wss };
}
