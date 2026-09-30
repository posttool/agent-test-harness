import { useEffect, useRef, useState } from "react";
import { buildSkinView, skinCommandToMessages, SkinManifestSchema, type ClientMessage, type HarnessSnapshot, type SkinManifest } from "@harness/core/skin";
import type { SkinCommandMessage, SkinStateMessage } from "@harness/skin-default";
import defaultManifestJson from "@harness/skin-default/skin.json";
import { parseArtboard, type PropSpec } from "@harness/dc-runtime";

const defaultManifest = SkinManifestSchema.parse(defaultManifestJson);
const SKIN_KEY = "harness.skin";

type Tweaks = Record<string, unknown>;

function savedTweaks(id: string): Tweaks {
  try {
    return JSON.parse(localStorage.getItem(`harness.tweaks.${id}`) ?? "{}") as Tweaks;
  } catch {
    return {};
  }
}

/** The design's tweakable props (data-props with an editor), first declaration wins. Parsing runs no design code. */
function tweakSpecs(artboards: Record<string, string>): Record<string, PropSpec> {
  const out: Record<string, PropSpec> = {};
  for (const [file, source] of Object.entries(artboards)) {
    try {
      for (const [k, spec] of Object.entries(parseArtboard(file, source).props)) if (spec?.editor && !out[k]) out[k] = spec;
    } catch {
      // An artboard that doesn't parse shows its error in the frame.
    }
  }
  return out;
}

function TweakControl({ name, spec, value, onChange }: { name: string; spec: PropSpec; value: unknown; onChange: (v: unknown) => void }) {
  const v = value ?? spec.default;
  const label = <span className="tweak-name">{name}</span>;
  if (spec.editor === "enum") {
    return (
      <label className="tweak">
        {label}
        <select value={String(v)} onChange={(e) => onChange(e.target.value)} aria-label={name}>
          {(spec.options ?? []).map((o) => (
            <option key={String(o)}>{String(o)}</option>
          ))}
        </select>
      </label>
    );
  }
  if (spec.editor === "color") {
    return (
      <label className="tweak">
        {label}
        <input type="color" aria-label={name} value={String(v).slice(0, 7)} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </label>
    );
  }
  if (spec.editor === "range" || spec.editor === "int" || spec.editor === "float") {
    return (
      <label className="tweak">
        {label}
        <input type="range" aria-label={name} min={spec.min ?? 0} max={spec.max ?? 100} step={spec.step ?? (spec.editor === "float" ? 0.1 : 1)} value={Number(v)} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="muted">
          {String(v)}
          {spec.unit ?? ""}
        </span>
      </label>
    );
  }
  if (spec.editor === "boolean") {
    return (
      <label className="tweak">
        {label}
        <input type="checkbox" aria-label={name} checked={Boolean(v)} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  return (
    <label className="tweak">
      {label}
      <input aria-label={name} value={String(v ?? "")} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

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
  const [specs, setSpecs] = useState<Record<string, PropSpec>>({});
  const [tweaks, setTweaks] = useState<Tweaks>(() => savedTweaks(savedSkin()));
  const tweaksRef = useRef(tweaks);
  tweaksRef.current = tweaks;

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

  const setTweak = (name: string, value: unknown) => {
    const next = { ...tweaksRef.current, [name]: value };
    setTweaks(next);
    try {
      localStorage.setItem(`harness.tweaks.${skin.id}`, JSON.stringify(next));
    } catch {
      // Remembering tweaks is a convenience only.
    }
    frame.current?.contentWindow?.postMessage({ type: "tweaks", tweaks: next }, "*");
  };

  const choose = (id: string) => {
    ready.current = false;
    setSpecs({});
    setTweaks(savedTweaks(id));
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
            setSpecs(tweakSpecs(pkg.artboards));
            target?.postMessage({ type: "package", manifest: pkg.manifest, canvas: pkg.canvas, artboards: pkg.artboards, tweaks: tweaksRef.current }, "*");
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
      {skin.renderer === "dc" && Object.keys(specs).length > 0 && (
        <details className="tweaks" data-testid="tweaks">
          <summary>Tweaks</summary>
          {Object.entries(specs).map(([name, spec]) => (
            <TweakControl key={name} name={name} spec={spec} value={tweaks[name]} onChange={(v) => setTweak(name, v)} />
          ))}
          <button className="link" onClick={() => (setTweaks({}), localStorage.removeItem(`harness.tweaks.${skin.id}`), frame.current?.contentWindow?.postMessage({ type: "tweaks", tweaks: {} }, "*"))}>
            Reset to the design's defaults
          </button>
        </details>
      )}
    </section>
  );
}
