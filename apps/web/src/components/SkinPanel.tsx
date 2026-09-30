import { useEffect, useState } from "react";
import { SkinManifestSchema, type SkinManifest } from "@harness/core/skin";
import { Badge, Collapsible, Empty } from "./common.tsx";

interface Reports {
  binding: string | null;
  bind: string | null;
  missing: string | null;
}

/**
 * Installed skins (docs/SKINS_FROM_CLAUDE_DESIGN.md section 8): where each came from, how its
 * screens map, what the analysis and binding found, and design briefs for missing screens.
 */
export function SkinPanel() {
  const [skins, setSkins] = useState<SkinManifest[]>([]);
  const [reports, setReports] = useState<Record<string, Reports>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = () =>
    void fetch("/api/skins")
      .then((r) => r.json())
      .then(async (list: unknown[]) => {
        const parsed = list.flatMap((m) => {
          const r = SkinManifestSchema.safeParse(m);
          return r.success ? [r.data] : [];
        });
        setSkins(parsed);
        const entries = await Promise.all(parsed.filter((s) => s.renderer === "dc").map(async (s) => [s.id, (await (await fetch(`/api/skins/${encodeURIComponent(s.id)}/reports`)).json()) as Reports] as const));
        setReports(Object.fromEntries(entries));
      })
      .catch(() => setNote("Could not load skins."));
  useEffect(load, []);

  const rebind = async (id: string) => {
    setBusy(id);
    setNote(null);
    try {
      const r = (await (await fetch(`/api/skins/${encodeURIComponent(id)}/bind`, { method: "POST" })).json()) as { ok?: boolean; error?: string };
      setNote(r.error ? `Rebind failed: ${r.error}` : r.ok ? "Rebound: every hard check passed. Pick the skin again to reload it." : "Rebound with failing checks; see the bind report.");
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="skin-panel" data-testid="skin-panel">
      <p className="muted">
        Install a Claude Design canvas in Claude Code with “install the skin at https://claude.ai/artifact/…”, or by hand:
      </p>
      <pre className="json">{"npm run skin:install -- skins/<id> --source <canvas URL>\nnpm run skin:analyze -- skins/<id>   # one model call per screen\nnpm run skin:bind -- skins/<id>      # no model calls"}</pre>
      {note && <div className="note">{note}</div>}
      {!skins.length && <Empty>No skins.</Empty>}
      {skins.map((s) => {
        const r = reports[s.id];
        return (
          <Collapsible
            key={s.id}
            open={s.renderer === "dc"}
            title={
              <>
                {s.name} <span className="muted">skins/{s.id}</span>
              </>
            }
            right={
              <>
                <Badge tone={s.renderer === "dc" ? "accent" : "plain"}>{s.renderer === "dc" ? "Claude Design" : "built in"}</Badge> <Badge tone={s.status === "complete" ? "ok" : "warn"}>{s.status}</Badge>
              </>
            }
          >
            {s.source && (
              <p>
                Source:{" "}
                <a href={s.source} target="_blank" rel="noreferrer">
                  {s.source}
                </a>
              </p>
            )}
            {Object.keys(s.screens).length > 0 && (
              <table className="kv">
                <tbody>
                  {Object.entries(s.screens).map(([screen, file]) => (
                    <tr key={screen}>
                      <td>{screen}</td>
                      <td>{file}</td>
                    </tr>
                  ))}
                  {s.missingScreens.map((m) => (
                    <tr key={m}>
                      <td>{m}</td>
                      <td>
                        <Badge tone="warn">missing</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {s.needs.length > 0 && <p>Asks the agent for: {s.needs.map((n) => n.id).join(", ")}</p>}
            {s.renderer === "dc" && (
              <button onClick={() => void rebind(s.id)} disabled={busy === s.id}>
                {busy === s.id ? "Binding…" : "Rebind"}
              </button>
            )}
            {r?.missing && s.missingScreens.length > 0 && (
              <Collapsible title="Screens to design (paste into Claude Design)" open>
                <pre className="report">{r.missing}</pre>
              </Collapsible>
            )}
            {r?.bind && (
              <Collapsible title="Bind report">
                <pre className="report">{r.bind}</pre>
              </Collapsible>
            )}
            {r?.binding && (
              <Collapsible title="Binding report (analysis)">
                <pre className="report">{r.binding}</pre>
              </Collapsible>
            )}
          </Collapsible>
        );
      })}
    </div>
  );
}
