import { useEffect, useState } from "react";
import { DataPanel } from "./components/DataPanel.tsx";
import { ExperiencePanel } from "./components/ExperiencePanel.tsx";
import { MemoryPanel } from "./components/MemoryPanel.tsx";
import { ModelSettings } from "./components/ModelSettings.tsx";
import { SkinPanel } from "./components/SkinPanel.tsx";
import { ToolsPanel } from "./components/ToolsPanel.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { TracesPanel } from "./components/TracesPanel.tsx";
import { useHarness } from "./useHarness.ts";

const PANELS = ["Memory", "Tools", "Data", "Traces", "Skin"] as const;
type Panel = (typeof PANELS)[number];

export function App() {
  const harness = useHarness();
  const { snapshot, traces, send } = harness;
  const [panel, setPanel] = useState<Panel>("Memory");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = snapshot?.settings.theme ?? "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!snapshot) {
    return <div className="loading">{harness.connected ? "Loading…" : "Connecting to the harness server…"}</div>;
  }
  return (
    <div className="app">
      <TopBar snapshot={snapshot} connected={harness.connected} send={send} onModels={() => setSettingsOpen(true)} />
      {harness.errors.map((e, i) => (
        <div className="toast" key={i} onClick={() => harness.dismissError(i)}>
          {e}
        </div>
      ))}
      <main>
        <ExperiencePanel snapshot={snapshot} send={send} />
        <section className="panels">
          <nav className="tabs" role="tablist">
            {PANELS.map((p) => (
              <button key={p} role="tab" aria-selected={p === panel} className={p === panel ? "on" : ""} onClick={() => setPanel(p)}>
                {p}
                {p === "Traces" && traces.length ? <span className="count">{new Set(traces.map((t) => t.triggerId).filter(Boolean)).size}</span> : null}
              </button>
            ))}
          </nav>
          <div className="panel-body">
            {panel === "Memory" && <MemoryPanel snapshot={snapshot} />}
            {panel === "Tools" && <ToolsPanel snapshot={snapshot} send={send} />}
            {panel === "Data" && <DataPanel snapshot={snapshot} send={send} />}
            {panel === "Traces" && <TracesPanel traces={traces} snapshot={snapshot} />}
            {panel === "Skin" && <SkinPanel />}
          </div>
        </section>
      </main>
      {settingsOpen && <ModelSettings snapshot={snapshot} send={send} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
