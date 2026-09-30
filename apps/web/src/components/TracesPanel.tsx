import { useMemo } from "react";
import type { HarnessSnapshot, ModelAttempt, TraceEntry } from "@harness/core/types";
import { Badge, Collapsible, Empty, Json, time } from "./common.tsx";

const TONES: Partial<Record<TraceEntry["kind"], "accent" | "ok" | "warn" | "bad">> = {
  decision: "accent",
  step_result: "ok",
  session_paused: "warn",
  error: "bad",
  session_ended: "ok",
};

function Attempts({ attempts }: { attempts: ModelAttempt[] }) {
  return (
    <table className="table small">
      <tbody>
        {attempts.map((a, i) => (
          <tr key={i}>
            <td>{a.role}</td>
            <td>{a.model}</td>
            <td>#{a.attempt}</td>
            <td>
              <Badge tone={a.outcome === "ok" ? "ok" : a.outcome.startsWith("skipped") ? "plain" : "bad"}>{a.errorKind ?? a.outcome}</Badge>
            </td>
            <td>{a.delayBeforeMs ? `waited ${a.delayBeforeMs} ms` : ""}</td>
            <td>{a.latencyMs} ms</td>
            <td>{a.usage ? `${a.usage.inputTokens}+${a.usage.cacheReadTokens}c → ${a.usage.outputTokens}${a.usage.costUsd !== null ? ` · $${a.usage.costUsd.toFixed(4)}` : ""}` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Entry({ entry }: { entry: TraceEntry }) {
  const d = entry.data as Record<string, unknown>;
  const summary =
    entry.kind === "decision"
      ? (() => {
          const decision = d.decision as { action: string; capability: string | null; rationale: string };
          return `${decision.action === "end" ? "end" : decision.capability}: ${decision.rationale}`;
        })()
      : entry.kind === "route"
        ? (d.decision as { action: string; rationale: string }).action + ": " + (d.decision as { rationale: string }).rationale
        : entry.kind === "step_start"
          ? `${String(d.capability)}: ${String(d.instruction)}`
          : entry.kind === "step_result"
            ? String(d.note ?? "")
            : entry.kind === "signal"
              ? String((d.signal as { content: string }).content).slice(0, 160)
              : entry.kind === "error"
                ? String(d.message)
                : entry.kind === "session_ended"
                  ? String(d.summary ?? "")
                  : "";
  return (
    <Collapsible
      title={
        <>
          <span className="muted">{time(entry.at)}</span> <Badge tone={TONES[entry.kind] ?? "plain"}>{entry.kind}</Badge> <span className="trace-summary">{summary}</span>
        </>
      }
    >
      {Array.isArray(d.attempts) ? <Attempts attempts={d.attempts as ModelAttempt[]} /> : null}
      <Json value={Object.fromEntries(Object.entries(d).filter(([k]) => k !== "attempts"))} />
    </Collapsible>
  );
}

/** Every reasoning step, grouped by the trigger that started it (PLAN.md section 9). */
export function TracesPanel({ traces, snapshot }: { traces: TraceEntry[]; snapshot: HarnessSnapshot }) {
  const groups = useMemo(() => {
    const map = new Map<string, TraceEntry[]>();
    for (const t of traces) {
      const key = t.triggerId ?? "system";
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()].reverse();
  }, [traces]);
  if (!groups.length) return <Empty>No reasoning yet.</Empty>;
  return (
    <div className="traces">
      {groups.map(([trigger, entries]) => {
        const signal = entries.find((e) => e.kind === "signal")?.data.signal as { kind: string; source: string; content: string } | undefined;
        const sessionId = entries.find((e) => e.sessionId)?.sessionId;
        const session = snapshot.sessions.find((s) => s.id === sessionId);
        const cost = entries.flatMap((e) => (Array.isArray(e.data.attempts) ? (e.data.attempts as ModelAttempt[]) : [])).reduce((sum, a) => sum + (a.usage?.costUsd ?? 0), 0);
        return (
          <Collapsible
            key={trigger}
            title={
              <>
                <span className="muted">{time(entries[0]!.at)}</span> <Badge>{signal?.kind ?? "system"}</Badge> <strong>{session?.title ?? signal?.source ?? trigger}</strong>{" "}
                <span className="trace-summary muted">{signal?.content.slice(0, 90)}</span>
              </>
            }
            right={
              <>
                {session ? <Badge tone={session.status === "failed" ? "bad" : session.status === "paused" ? "warn" : session.status === "ended" ? "ok" : "accent"}>{session.status}</Badge> : null}
                {cost ? <span className="muted"> ${cost.toFixed(3)}</span> : null}
              </>
            }
          >
            {entries.map((e) => (
              <Entry key={e.id} entry={e} />
            ))}
          </Collapsible>
        );
      })}
    </div>
  );
}
