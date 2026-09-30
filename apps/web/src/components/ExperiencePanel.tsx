import { useEffect, useRef, useState } from "react";
import { buildSkinView, skinCommandToMessages, SkinManifestSchema, type ClientMessage, type HarnessSnapshot, type SkinManifest } from "@harness/core/skin";
import type { SkinCommandMessage, SkinStateMessage } from "@harness/skin-default";
import defaultManifestJson from "@harness/skin-default/skin.json";

const defaultManifest = SkinManifestSchema.parse(defaultManifestJson);
const SKIN_KEY = "harness.skin";

function savedSkin(): string {
  try {
    return localStorage.getItem(SKIN_KEY) ?? "default";
  } catch {
    return "default";
  }
}

/**
 * Hosts the skin in an iframe (isolated styles) and relays the skin contract and commands.
 * Claude Design skins run untrusted design code, so their frame is sandboxed (no same-origin)
 * and every command they send is checked against the snapshot before it reaches the runtime.
 */
export function ExperiencePanel({ snapshot, send }: { snapshot: HarnessSnapshot; send: (m: ClientMessage) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const lastSent = useRef("");
  const [skins, setSkins] = useState<SkinManifest[]>([defaultManifest]);
  const [skinId, setSkinId] = useState(savedSkin);
  const skin = skins.find((s) => s.id === skinId) ?? defaultManifest;

  const state: SkinStateMessage = { type: "state", view: buildSkinView(snapshot) };
  const stateRef = useRef(state);
  stateRef.current = state;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const skinRef = useRef(skin);
  skinRef.current = skin;

  useEffect(() => {
    void fetch("/api/skins")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: unknown[]) => {
        const parsed = list.flatMap((m) => {
          const r = SkinManifestSchema.safeParse(m);
          return r.success ? [r.data] : [];
        });
        if (parsed.length) setSkins(parsed);
      })
      .catch(() => {});
  }, []);

  const choose = (id: string) => {
    ready.current = false;
    setSkinId(id);
    try {
      localStorage.setItem(SKIN_KEY, id);
    } catch {
      // Remembering the choice is a convenience only.
    }
  };

  useEffect(() => {
    const onMessage = (e: MessageEvent<SkinCommandMessage | { type: "ready" }>) => {
      if (e.source !== frame.current?.contentWindow) return;
      const target = frame.current?.contentWindow;
      if (e.data?.type === "ready") {
        const current = skinRef.current;
        const deliver = () => {
          ready.current = true;
          lastSent.current = JSON.stringify(stateRef.current);
          target?.postMessage(stateRef.current, "*");
        };
        if (current.renderer !== "dc") return deliver();
        // A Claude Design skin gets its files from the host; the sandboxed frame has no network access of its own.
        void fetch(`/api/skins/${encodeURIComponent(current.id)}`)
          .then((r) => r.json())
          .then((pkg: { manifest: SkinManifest; canvas: unknown; artboards: Record<string, string> }) => {
            target?.postMessage(stateRef.current, "*");
            target?.postMessage({ type: "package", manifest: pkg.manifest, canvas: pkg.canvas, artboards: pkg.artboards, tweaks: {} }, "*");
            deliver();
          });
      }
      if (e.data?.type === "command") for (const m of skinCommandToMessages(e.data.command, snapshotRef.current, skinRef.current)) send(m);
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
        {skin.renderer === "dc" ? (
          <iframe key={skin.id} ref={frame} src="/dc-skin.html" sandbox="allow-scripts" title="Experience" data-testid="experience" />
        ) : (
          <iframe key={skin.id} ref={frame} src="/skin.html" title="Experience" data-testid="experience" />
        )}
      </div>
      <div className="experience-meta muted">
        <select value={skin.id} onChange={(e) => choose(e.target.value)} aria-label="Skin" data-testid="skin-picker">
          {skins.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.status === "incomplete" ? " (incomplete)" : ""}
            </option>
          ))}
        </select>{" "}
        · {t.toISOString().slice(0, 16).replace("T", " ")} virtual · {snapshot.device.location ?? "location unknown"}
      </div>
    </section>
  );
}
