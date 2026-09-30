import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { ClientMessageSchema, type ProviderClient, type ProviderId, type ServerMessage } from "@harness/core";
import type { HarnessRuntime } from "@harness/runtime";
import { createModelProxy } from "./modelProxy.ts";
import { listSkins, loadSkin } from "./skins.ts";

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
  /** The repo's skins/ folder, served read-only at /api/skins. */
  skinsDir?: string;
}

/**
 * The page that plays Claude Design skins. It runs untrusted design code, so it is framed with
 * sandbox="allow-scripts" (an opaque origin) and may load only its own scripts and Google Fonts.
 */
const DC_SKIN_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

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
      const url = (req.url ?? "/").split("?")[0]!;
      if (url === "/api/skins" || url.startsWith("/api/skins/")) {
        const json = (status: number, body: unknown) => void res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
        if (!options.skinsDir) return json(200, []);
        if (url === "/api/skins") return json(200, listSkins(options.skinsDir));
        const pkg = loadSkin(options.skinsDir, decodeURIComponent(url.slice("/api/skins/".length)));
        return pkg ? json(200, pkg) : json(404, { error: "No such skin" });
      }
      if (!options.staticDir) return void res.writeHead(404).end("Not found");
      const path = (req.url ?? "/").split("?")[0]!;
      const file = normalize(join(options.staticDir, path === "/" ? "index.html" : path));
      if (!file.startsWith(options.staticDir) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end("Not found");
      // The sandboxed skin page has an opaque origin, so its module scripts and styles load cross-origin.
      const headers: Record<string, string> = { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" };
      if (path === "/dc-skin.html") headers["content-security-policy"] = DC_SKIN_CSP;
      res.writeHead(200, headers).end(readFileSync(file));
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
