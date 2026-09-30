import { useState } from "react";
import type { ClientMessage, EffortLevel, HarnessSnapshot, ModelPolicy, ModelRef, ModelRole } from "@harness/core/types";

const MODELS: ModelRef[] = [
  { provider: "claude", model: "claude-opus-5-5", serverFallback: true },
  { provider: "claude", model: "claude-opus-5", serverFallback: true },
  { provider: "claude", model: "claude-sonnet-5-5", serverFallback: true },
  { provider: "claude", model: "claude-haiku-4-5", serverFallback: false },
  { provider: "gemini", model: "gemini-3.8-flash", serverFallback: false },
  { provider: "gemini", model: "gemini-3.7-flash", serverFallback: false },
];
const ROLES: ModelRole[] = ["loop", "router", "memoryMerge", "device", "judge", "simulator"];
const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
const byModel = (model: string) => MODELS.find((m) => m.model === model) ?? MODELS[0]!;

export function ModelSettings({ snapshot, send, onClose }: { snapshot: HarnessSnapshot; send: (m: ClientMessage) => void; onClose: () => void }) {
  const [policy, setPolicy] = useState<ModelPolicy>(structuredClone(snapshot.settings.policy));
  const [windowSeconds, setWindowSeconds] = useState(snapshot.settings.signalWindowSeconds);
  const set = (patch: Partial<ModelPolicy>) => setPolicy({ ...policy, ...patch });
  const move = (i: number, d: number) => {
    const next = [...policy.fallbacks];
    const [item] = next.splice(i, 1);
    next.splice(i + d, 0, item!);
    set({ fallbacks: next });
  };
  const rests = snapshot.models.rests;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Model settings">
        <h2>Models</h2>
        <p className="muted">
          Configured: {snapshot.models.configured.join(", ") || "none"}
          {snapshot.models.disabled.length ? ` · disabled after auth errors: ${snapshot.models.disabled.join(", ")}` : ""}
        </p>
        <label className="row">
          Primary
          <select value={policy.primary.model} onChange={(e) => set({ primary: byModel(e.target.value) })}>
            {MODELS.map((m) => (
              <option key={m.model}>{m.model}</option>
            ))}
          </select>
        </label>
        <h3>Fallback chain</h3>
        {policy.fallbacks.map((f, i) => {
          const rest = rests[`${f.provider}:${f.model}`];
          return (
            <div className="row" key={i}>
              <span>
                {i + 1}. {f.model} {rest?.resting ? <span className="badge warn">resting</span> : null}
              </span>
              <span>
                <button disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                <button disabled={i === policy.fallbacks.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button onClick={() => set({ fallbacks: policy.fallbacks.filter((_, j) => j !== i) })}>✕</button>
              </span>
            </div>
          );
        })}
        <select value="" onChange={(e) => e.target.value && set({ fallbacks: [...policy.fallbacks, byModel(e.target.value)] })}>
          <option value="">Add fallback…</option>
          {MODELS.map((m) => (
            <option key={m.model}>{m.model}</option>
          ))}
        </select>
        <h3>Per role</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Model</th>
              <th>Claude effort</th>
            </tr>
          </thead>
          <tbody>
            {ROLES.map((role) => (
              <tr key={role}>
                <td>{role}</td>
                <td>
                  <select
                    value={policy.roles[role]?.primary?.model ?? ""}
                    onChange={(e) => {
                      const roles = { ...policy.roles };
                      if (e.target.value) roles[role] = { ...roles[role], primary: byModel(e.target.value) };
                      else delete roles[role];
                      set({ roles });
                    }}
                  >
                    <option value="">(primary)</option>
                    {MODELS.map((m) => (
                      <option key={m.model}>{m.model}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={policy.effort[role]} onChange={(e) => set({ effort: { ...policy.effort, [role]: e.target.value as EffortLevel } })}>
                    {EFFORTS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>Resting strategy</h3>
        <div className="grid2">
          {(
            [
              ["maxAttempts", "Attempts per model"],
              ["baseDelayMs", "Base delay (ms)"],
              ["maxDelayMs", "Max delay (ms)"],
              ["restAfterFailures", "Rest after failures"],
              ["restMs", "Rest (ms)"],
              ["maxRestMs", "Max rest (ms)"],
              ["stepBudgetMs", "Budget per call (ms)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="row">
              {label}
              <input type="number" value={policy.resting[key]} onChange={(e) => set({ resting: { ...policy.resting, [key]: Number(e.target.value) } })} />
            </label>
          ))}
          <label className="row">
            Request timeout (ms)
            <input type="number" value={policy.timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) })} />
          </label>
          <label className="row">
            Signal window (virtual s)
            <input type="number" value={windowSeconds} onChange={(e) => setWindowSeconds(Number(e.target.value))} />
          </label>
        </div>
        <div className="actions">
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            onClick={() => {
              send({ type: "settings", policy, signalWindowSeconds: windowSeconds });
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
