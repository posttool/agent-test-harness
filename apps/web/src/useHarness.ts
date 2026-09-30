import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, HarnessSnapshot, ServerMessage, TraceEntry } from "@harness/core/types";

export interface Harness {
  snapshot: HarnessSnapshot | null;
  traces: TraceEntry[];
  connected: boolean;
  errors: string[];
  send: (message: ClientMessage) => void;
  dismissError: (i: number) => void;
}

/** One WebSocket to the harness server: live snapshot, streaming traces, commands. */
export function useHarness(url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`): Harness {
  const [snapshot, setSnapshot] = useState<HarnessSnapshot | null>(null);
  const [traces, setTraces] = useState<TraceEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1000);
      };
      ws.onmessage = (e) => {
        const message = JSON.parse(String(e.data)) as ServerMessage;
        if (message.type === "snapshot") setSnapshot(message.snapshot);
        if (message.type === "traces") setTraces((prev) => (message.reset ? message.entries : [...prev, ...message.entries]));
        if (message.type === "error") setErrors((prev) => [...prev.slice(-4), message.message]);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [url]);

  const send = useCallback((message: ClientMessage) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  }, []);
  const dismissError = useCallback((i: number) => setErrors((prev) => prev.filter((_, j) => j !== i)), []);
  return { snapshot, traces, connected, errors, send, dismissError };
}
