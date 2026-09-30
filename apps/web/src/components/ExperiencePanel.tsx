import { useEffect, useRef } from "react";
import type { ClientMessage, HarnessSnapshot } from "@harness/core/types";
import type { SkinCommandMessage, SkinStateMessage } from "@harness/skin-default";

/** Hosts the skin in an iframe (isolated styles) and relays state and commands. */
export function ExperiencePanel({ snapshot, send }: { snapshot: HarnessSnapshot; send: (m: ClientMessage) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const lastSent = useRef("");

  const state: SkinStateMessage = {
    type: "state",
    device: snapshot.device,
    apps: snapshot.tools.definitions.map((t) => ({ id: t.id, name: t.name })),
    theme: snapshot.settings.theme,
  };
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const onMessage = (e: MessageEvent<SkinCommandMessage | { type: "ready" }>) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data.type === "ready") {
        ready.current = true;
        lastSent.current = JSON.stringify(stateRef.current);
        frame.current?.contentWindow?.postMessage(stateRef.current, "*");
      }
      if (e.data.type === "command") send(e.data.command);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [send]);

  // Post to the skin only when what it shows actually changed.
  useEffect(() => {
    const text = JSON.stringify(state);
    if (!ready.current || text === lastSent.current) return;
    lastSent.current = text;
    frame.current?.contentWindow?.postMessage(state, "*");
  });

  const t = new Date(snapshot.ambient.virtualNow);
  return (
    <section className="experience">
      <div className="phone">
        <iframe ref={frame} src="/skin.html" title="Experience" data-testid="experience" />
      </div>
      <div className="experience-meta muted">
        {t.toISOString().slice(0, 16).replace("T", " ")} virtual · {snapshot.device.location ?? "location unknown"}
      </div>
    </section>
  );
}
