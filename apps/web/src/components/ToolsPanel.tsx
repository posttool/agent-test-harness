import { useState } from "react";
import { ToolProposalSchema, type ClientMessage, type HarnessSnapshot } from "@harness/core/types";
import { Badge, Collapsible, Empty, Json, time } from "./common.tsx";

const TEMPLATE = JSON.stringify(
  {
    name: "My tool",
    description: "What it does",
    source: "generated_code",
    endpoint: null,
    code: "async function hello(args) { return { greeting: 'hi ' + args.name }; }",
    functions: [
      {
        name: "hello",
        description: "Say hello",
        paramsJsonSchema: '{"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
        returnsJsonSchema: '{"type":"object"}',
        oversight: "auto_from_memory",
        longRunning: false,
      },
    ],
  },
  null,
  2,
);

const tone = (o: string) => (o === "always_ask" ? "bad" : o === "confirm" ? "warn" : o === "auto_notify" ? "accent" : "ok");

export function ToolsPanel({ snapshot, send }: { snapshot: HarnessSnapshot; send: (m: ClientMessage) => void }) {
  const [draft, setDraft] = useState(TEMPLATE);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const t = snapshot.tools;
  const create = () => {
    try {
      send({ type: "tool_add", proposal: ToolProposalSchema.parse(JSON.parse(draft)) });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="tools">
      <h3>Tools</h3>
      {t.definitions.map((tool) => (
        <Collapsible
          key={tool.id}
          title={
            <>
              {tool.name} <Badge>{tool.source}</Badge>
            </>
          }
          right={tool.source === "builtin" ? <span className="muted">built-in</span> : <button onClick={(e) => (e.stopPropagation(), send({ type: "tool_delete", toolId: tool.id }))}>Delete</button>}
        >
          <p>{tool.description}</p>
          {tool.functions.map((f) => (
            <div key={f.name} className="fn">
              <code>{f.name}</code> <Badge tone={tone(f.oversight)}>{f.oversight}</Badge> {f.longRunning ? <Badge tone="accent">long-running</Badge> : null}
              <div className="muted">{f.description}</div>
            </div>
          ))}
          {tool.code ? <pre className="json">{tool.code}</pre> : null}
          {tool.endpoint ? <p className="muted">Endpoint: {tool.endpoint}</p> : null}
          <p className="muted">
            Via {tool.provenance.discoveredVia}
            {tool.provenance.createdBySessionId ? ` in ${tool.provenance.createdBySessionId}` : ""}
          </p>
        </Collapsible>
      ))}
      <div className="row">
        <select value={suggestion} onChange={(e) => setSuggestion(e.target.value)} aria-label="Tool suggestion">
          <option value="">Add a suggested tool…</option>
          {t.suggestions.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <button disabled={!suggestion} onClick={() => send({ type: "tool_add_suggestion", name: suggestion })}>
          Add
        </button>
      </div>
      <Collapsible title="Create a tool">
        <textarea className="code" value={draft} onChange={(e) => setDraft(e.target.value)} rows={16} />
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" onClick={create}>
          Create
        </button>
      </Collapsible>

      <h3>Waiting for approval</h3>
      {t.approvals.filter((a) => a.status === "pending").length ? (
        t.approvals
          .filter((a) => a.status === "pending")
          .map((a) => (
            <div key={a.id} className="log-row">
              <code>
                {a.toolId}.{a.functionName}
              </code>{" "}
              {a.argsJson} <span className="muted">asked in the phone's Spaces</span>
            </div>
          ))
      ) : (
        <Empty>Nothing waiting.</Empty>
      )}

      <h3>Subscriptions</h3>
      {t.subscriptions.length ? (
        t.subscriptions.map((s) => (
          <div key={s.id} className="log-row">
            <Badge tone={s.status === "active" ? "accent" : s.status === "completed" ? "ok" : "bad"}>{s.status}</Badge> {s.toolId}.{s.functionName} <span className="muted">→ {s.sessionId}</span>
          </div>
        ))
      ) : (
        <Empty>No long-running processes.</Empty>
      )}

      <h3>Calls</h3>
      {t.calls.length ? (
        [...t.calls].reverse().map((c) => (
          <Collapsible
            key={c.id}
            title={
              <>
                <span className="muted">{time(c.at)}</span> {c.toolId}.{c.functionName}
              </>
            }
            right={<Badge tone={c.status === "ok" ? "ok" : c.status === "error" || c.status === "denied" ? "bad" : "warn"}>{c.status}</Badge>}
          >
            <Json value={{ args: c.args, result: c.result, error: c.error, session: c.sessionId }} />
          </Collapsible>
        ))
      ) : (
        <Empty>No tool calls yet.</Empty>
      )}
    </div>
  );
}
