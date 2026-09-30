import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useState } from "react";
import type { HarnessSnapshot, MemoryNode, Topic } from "@harness/core/types";
import { Badge, Collapsible, Empty, Json, time } from "./common.tsx";

const COLORS: Record<string, string> = {
  topic: "#7c9cff",
  document: "#b48cff",
  person: "#4fd18b",
  place: "#35c7c7",
  personal_preference: "#ffb35c",
  calendar_entry: "#ff7a90",
  project_context: "#c9d36a",
  tool_knowledge: "#8fa3b8",
  active_process: "#ff9f43",
  ambient_state: "#6b7a90",
};
type GNode = SimulationNodeDatum & { id: string; node: MemoryNode };
type GLink = SimulationLinkDatum<GNode> & { type: string };

function Graph({ snapshot, onSelect, selected }: { snapshot: HarnessSnapshot; onSelect: (id: string) => void; selected: string | null }) {
  const { nodes, edges } = snapshot.memory;
  const [layout, setLayout] = useState<{ nodes: GNode[]; links: GLink[] }>({ nodes: [], links: [] });
  const key = nodes.map((n) => n.id).join() + edges.map((e) => e.id).join();
  useEffect(() => {
    const gNodes: GNode[] = nodes.map((n) => ({ id: n.id, node: n }));
    const ids = new Set(gNodes.map((n) => n.id));
    const links: GLink[] = edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => ({ source: e.from, target: e.to, type: e.type }));
    const sim = forceSimulation(gNodes)
      .force("link", forceLink<GNode, GLink>(links).id((d) => d.id).distance(70))
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(0, 0))
      .stop();
    for (let i = 0; i < 250; i++) sim.tick();
    setLayout({ nodes: gNodes, links });
  }, [key]);
  if (!nodes.length) return <Empty>Memory is empty. Send the agent something, or start a persona's day.</Empty>;
  const xs = layout.nodes.map((n) => n.x ?? 0);
  const ys = layout.nodes.map((n) => n.y ?? 0);
  // Fit the layout, but never zoom in past a comfortable scale when there are few nodes.
  const pad = 40;
  const width = Math.max(Math.max(...xs) - Math.min(...xs) + pad * 2, 640);
  const height = Math.max(Math.max(...ys) - Math.min(...ys) + pad * 2, 420);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const box = [cx - width / 2, cy - height / 2, width, height].join(" ");
  return (
    <svg className="graph" viewBox={box} data-testid="memory-graph">
      {layout.links.map((l, i) => {
        const s = l.source as GNode;
        const t = l.target as GNode;
        return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} className="edge"><title>{l.type}</title></line>;
      })}
      {layout.nodes.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`} onClick={() => onSelect(n.id)} className={`gnode${selected === n.id ? " sel" : ""}${n.node.status !== "live" ? " dim" : ""}`}>
          <circle r={n.node.type === "topic" ? 11 : 8} fill={COLORS[n.node.type] ?? "#999"} />
          <text y={22} textAnchor="middle">{n.node.title.length > 22 ? `${n.node.title.slice(0, 21)}…` : n.node.title}</text>
        </g>
      ))}
    </svg>
  );
}

function TopicTree({ topics, parent = null, depth = 0 }: { topics: Topic[]; parent?: string | null; depth?: number }) {
  const children = topics.filter((t) => t.parentId === parent);
  return (
    <>
      {children.map((t) => (
        <div key={t.id} style={{ marginLeft: depth * 16 }}>
          <Collapsible
            title={
              <>
                {t.title} <Badge tone={t.stage === "active" ? "accent" : t.stage === "done" || t.stage === "archived" ? "plain" : "warn"}>{t.stage}</Badge>
                {t.meta.newSinceLastSeen ? <Badge tone="ok">new</Badge> : null}
              </>
            }
            right={<span className="muted">{t.category}</span>}
          >
            <p>{t.meta.summary}</p>
            {t.meta.dueDates.length ? <p>Due: {t.meta.dueDates.map((d) => `${d.label || d.kind} ${d.value}`).join("; ")}</p> : null}
            {t.meta.triggers.length ? <p>Triggers: {t.meta.triggers.map((r) => `${r.kind}${r.qualifier ? ` ${r.qualifier}` : ""} ${r.value}`).join("; ")}</p> : null}
            {t.meta.userOverrides.length ? <p>Overrides: {t.meta.userOverrides.map((o) => o.note).join("; ")}</p> : null}
            {t.meta.newSinceLastSeen ? <p>New: {t.meta.newSinceLastSeen.summary}</p> : null}
            {t.meta.progress ? (
              <ul>
                {t.meta.progress.milestones.map((m, i) => (
                  <li key={i}>
                    {m.title} <Badge>{m.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </Collapsible>
          <TopicTree topics={topics} parent={t.id} depth={depth + 1} />
        </div>
      ))}
    </>
  );
}

export function MemoryPanel({ snapshot }: { snapshot: HarnessSnapshot }) {
  const [view, setView] = useState<"Graph" | "Topics" | "Documents" | "Calendar" | "Events">("Graph");
  const [selected, setSelected] = useState<string | null>(null);
  const m = snapshot.memory;
  const node = m.nodes.find((n) => n.id === selected);
  const links = useMemo(() => m.edges.filter((e) => e.from === selected || e.to === selected), [m.edges, selected]);
  return (
    <div className="memory">
      <div className="subtabs">
        {(["Graph", "Topics", "Documents", "Calendar", "Events"] as const).map((v) => (
          <button key={v} className={v === view ? "on" : ""} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        <span className="muted right">
          {m.nodes.length} nodes · {m.edges.length} links · {m.schemaExtensions.length} extensions
        </span>
      </div>
      {view === "Graph" && (
        <div className="graph-wrap">
          <Graph snapshot={snapshot} onSelect={setSelected} selected={selected} />
          {node ? (
            <aside className="inspector">
              <h3>{node.title}</h3>
              <p>
                <Badge tone="accent">{node.type}</Badge> <Badge>{node.status}</Badge> <span className="muted">v{node.version}</span>
              </p>
              <p>{node.summary}</p>
              <Json value={node.attributes} />
              <h4>Links</h4>
              {links.map((e) => (
                <div key={e.id} className="muted">
                  {e.from === node.id ? `→ ${e.type} → ${m.nodes.find((n) => n.id === e.to)?.title}` : `← ${e.type} ← ${m.nodes.find((n) => n.id === e.from)?.title}`}
                </div>
              ))}
              <p className="muted">From events: {node.sourceEventIds.join(", ")}</p>
            </aside>
          ) : null}
        </div>
      )}
      {view === "Topics" && (m.topics.length ? <TopicTree topics={m.topics} /> : <Empty>No topics yet.</Empty>)}
      {view === "Documents" &&
        (m.documents.length ? (
          m.documents.map((d) => (
            <Collapsible key={d.id} title={<>{d.title} {d.archivedAt ? <Badge>archived</Badge> : null}</>} right={<span className="muted">{d.revisionIds.length} revisions</span>}>
              <p>{d.description}</p>
              {d.sections.map((s) => (
                <div key={s.id} className="section">
                  <strong>{s.title}</strong> <Badge>{s.kind}</Badge>
                  <p className="pre">{s.body}</p>
                </div>
              ))}
              {d.processes.map((p) => (
                <p key={p.id}>
                  ⏳ {p.label}: <Badge tone={p.status === "complete" ? "ok" : p.status === "snag" || p.status === "failed" ? "bad" : "accent"}>{p.status}</Badge> {p.detail}
                </p>
              ))}
              <h4>History</h4>
              {m.revisions
                .filter((r) => r.documentId === d.id)
                .map((r) => (
                  <div key={r.id} className="muted">
                    {time(r.at)} {r.actor}: {r.action}
                  </div>
                ))}
            </Collapsible>
          ))
        ) : (
          <Empty>No documents yet.</Empty>
        ))}
      {view === "Calendar" &&
        (m.calendar.length ? (
          <table className="table">
            <tbody>
              {m.calendar.map((c) => (
                <tr key={c.id}>
                  <td>{c.start.replace("T", " ").slice(0, 16)}</td>
                  <td>{c.title}</td>
                  <td>
                    <Badge tone={c.status === "penciled" ? "warn" : c.status === "confirmed" ? "ok" : "plain"}>{c.status === "penciled" ? "penciled in" : c.status}</Badge>
                  </td>
                  <td className="muted">{c.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>The agent's calendar is empty.</Empty>
        ))}
      {view === "Events" &&
        (m.events.length ? (
          [...m.events].reverse().map((e) => (
            <div key={e.id} className="log-row">
              <span className="muted">{time(e.at)}</span> <Badge>{e.kind}</Badge> {e.description}
            </div>
          ))
        ) : (
          <Empty>No memory events yet.</Empty>
        ))}
    </div>
  );
}
