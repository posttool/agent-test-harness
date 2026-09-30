import { useState } from "react";
import type { ClientMessage, HarnessSnapshot } from "@harness/core/types";
import { Badge, Empty, time } from "./common.tsx";

const SPEEDS = [1, 10, 60, 300, 1200];

export function DataPanel({ snapshot, send }: { snapshot: HarnessSnapshot; send: (m: ClientMessage) => void }) {
  const a = snapshot.ambient;
  const [template, setTemplate] = useState("");
  const [vibe, setVibe] = useState("");
  return (
    <div className="data">
      <div className="row">
        <label className="switch">
          <input type="checkbox" checked={a.enabled} onChange={(e) => send({ type: "ambient_global", enabled: e.target.checked })} /> Emission {a.enabled ? "on" : "off"}
        </label>
        <label>
          Speed{" "}
          <select value={a.speed} onChange={(e) => send({ type: "ambient_global", speed: Number(e.target.value) })} aria-label="Speed">
            {[...new Set([...SPEEDS, a.speed])].sort((x, y) => x - y).map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <span className="muted">{new Date(a.virtualNow).toISOString().slice(0, 16).replace("T", " ")} virtual</span>
      </div>

      <h3>Sources</h3>
      {a.sources.length ? (
        a.sources.map((s) => {
          const total = Array.isArray(s.definition.events) ? s.definition.events.length : 0;
          return (
            <div key={s.id} className="source">
              <div className="row">
                <strong>{s.name}</strong> <Badge>{s.kind}</Badge> {s.ownerSubscriptionId ? <Badge tone="accent">tool progress</Badge> : null}
                <span className="muted">
                  {s.cursor}/{total} emitted
                </span>
              </div>
              <div className="row">
                <label className="switch">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => send({ type: "ambient_update", sourceId: s.id, enabled: e.target.checked })} /> on
                </label>
                <label>
                  rate ×
                  <input type="number" step="0.5" min="0.1" value={s.speed} onChange={(e) => send({ type: "ambient_update", sourceId: s.id, speed: Number(e.target.value) })} style={{ width: 60 }} />
                </label>
                <button onClick={() => send({ type: "ambient_remove", sourceId: s.id })}>Remove</button>
              </div>
              <div className="bar">
                <div className="fill" style={{ width: `${total ? (s.cursor / total) * 100 : 0}%` }} />
              </div>
            </div>
          );
        })
      ) : (
        <Empty>No data streams. Add one from a template, describe one, or start a persona's day.</Empty>
      )}

      <div className="row">
        <select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">
          <option value="">Add from template…</option>
          {snapshot.templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button disabled={!template} onClick={() => send({ type: "ambient_add_template", templateId: template })}>
          Add
        </button>
      </div>
      <div className="row">
        <input value={vibe} onChange={(e) => setVibe(e.target.value)} placeholder="Describe a new stream, e.g. 'a smart fridge that notices what runs out'" style={{ flex: 1 }} />
        <button
          disabled={!vibe.trim()}
          onClick={() => {
            send({ type: "ambient_vibe", description: vibe });
            setVibe("");
          }}
        >
          Create
        </button>
      </div>

      <h3>Recent events</h3>
      {a.recentEvents.length ? (
        [...a.recentEvents].reverse().map((e) => (
          <div key={e.id} className="log-row">
            <span className="muted">{time(e.at)}</span> <Badge>{e.kind}</Badge> {e.content}
          </div>
        ))
      ) : (
        <Empty>No events yet.</Empty>
      )}
    </div>
  );
}
