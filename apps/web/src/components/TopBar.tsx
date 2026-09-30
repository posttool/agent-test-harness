import { useState } from "react";
import type { ClientMessage, HarnessSnapshot } from "@harness/core/types";

export function TopBar({ snapshot, connected, send, onModels }: { snapshot: HarnessSnapshot; connected: boolean; send: (m: ClientMessage) => void; onModels: () => void }) {
  const [personaId, setPersonaId] = useState("");
  const active = snapshot.persona.active;
  const primary = snapshot.settings.policy.primary;
  return (
    <header className="topbar">
      <div className="brand">
        <span className={`live${connected ? " on" : ""}`} title={connected ? "Connected" : "Disconnected"} />
        Agent Harness
      </div>
      <div className="persona">
        {active ? (
          <>
            <span className="muted">Simulating</span> <strong>{active.name}</strong> <span className="muted">{active.date}</span>
            <button onClick={() => send({ type: "persona_stop" })}>Stop</button>
          </>
        ) : (
          <>
            <select value={personaId} onChange={(e) => setPersonaId(e.target.value)} aria-label="Persona">
              <option value="">Aura persona…</option>
              {snapshot.persona.personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.occupation ? ` · ${p.occupation}` : ""}
                </option>
              ))}
            </select>
            <button disabled={!personaId} onClick={() => send({ type: "persona_start", personaId })}>
              Start day
            </button>
          </>
        )}
      </div>
      <div className="spacer" />
      <div className="status muted">
        {snapshot.busySessions ? <span className="busy">● reasoning ({snapshot.busySessions})</span> : "idle"} · {snapshot.clients} client{snapshot.clients === 1 ? "" : "s"}
      </div>
      <button onClick={onModels} title="Model settings">
        {primary.model}
      </button>
      <button onClick={() => send({ type: "settings", theme: snapshot.settings.theme === "dark" ? "light" : "dark" })} title="Toggle theme">
        {snapshot.settings.theme === "dark" ? "☀︎" : "☾"}
      </button>
      <button className="danger" onClick={() => confirm("Clear memory, tools, data streams and traces?") && send({ type: "clear" })}>
        Clear memory
      </button>
    </header>
  );
}
