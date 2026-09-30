import { useEffect, useRef } from "react";
import { buildSkinView, skinCommandToMessages, SkinManifestSchema, type ClientMessage, type HarnessSnapshot } from "@harness/core/skin";
import type { SkinCommandMessage, SkinStateMessage } from "@harness/skin-default";
import manifestJson from "@harness/skin-default/skin.json";

const manifest = SkinManifestSchema.parse(manifestJson);

/** Hosts the skin in an iframe (isolated styles) and relays state and commands. */
export function ExperiencePanel({ snapshot, send }: { snapshot: HarnessSnapshot; send: (m: ClientMessage) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const lastSent = useRef("");

  const state: SkinStateMessage = { type: "state", view: buildSkinView(snapshot) };
  const stateRef = useRef(state);
  stateRef.current = state;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    const onMessage = (e: MessageEvent<SkinCommandMessage | { type: "ready" }>) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data.type === "ready") {
        ready.current = true;
        lastSent.current = JSON.stringify(stateRef.current);
        frame.current?.contentWindow?.postMessage(stateRef.current, "*");
      }
      // Skin code is untrusted: its commands are checked against the snapshot before they reach the runtime.
      if (e.data.type === "command") for (const m of skinCommandToMessages(e.data.command, snapshotRef.current, manifest)) send(m);
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
