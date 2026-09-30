import type { HarnessSnapshot } from "../types/HarnessSnapshot.ts";
import type { MemoryNode } from "../types/MemoryNode.ts";
import type { SkinBriefRow, SkinViewModel } from "../types/SkinViewModel.ts";
import type { SurfaceItem } from "../types/SurfaceItem.ts";

const FINISHED = new Set(["complete", "completed", "cancelled", "canceled", "failed", "done", "finished"]);

function clockParts(iso: string): SkinViewModel["now"] {
  const t = new Date(iso);
  return {
    iso,
    time: t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }),
    date: t.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
    weekday: t.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
  };
}

function row(item: SurfaceItem): SkinBriefRow {
  const kind = item.context ? "question" : item.component.kind === "notice" ? "notice" : "item";
  return {
    id: item.id,
    kind,
    title: item.component.title ?? (kind === "question" ? "Needs your answer" : "Update"),
    line: item.component.elements.find((e) => e.text)?.text ?? item.reason ?? "",
    cta: item.component.primaryActionLabel ?? (kind === "question" ? "Answer" : "Open"),
    reason: item.reason ?? "",
    icon: item.icon ?? (kind === "question" ? "alert" : "info"),
    badge: item.badge ?? "",
    topicId: item.topicId,
    documentId: item.context ? null : item.documentId,
    questionId: item.context?.uiRequestId ?? null,
  };
}

/** The newest process still running, for the Dynamic Island. */
function runningProcess(nodes: MemoryNode[]): SkinViewModel["island"]["process"] {
  const running = nodes
    .filter((n) => n.type === "active_process" && n.status === "live" && !FINISHED.has(String(n.attributes.status ?? "").toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!running) return null;
  const a = running.attributes;
  const raw = typeof a.progress === "number" ? a.progress : null;
  const eta = typeof a.eta === "string" ? a.eta : typeof a.etaMinutes === "number" ? `${a.etaMinutes} min` : "";
  return {
    label: running.title,
    status: String(a.status ?? ""),
    detail: String(a.detail ?? ""),
    progress: raw === null ? null : raw > 1 ? raw / 100 : raw,
    eta,
  };
}

/**
 * Builds skin contract v1 from a runtime snapshot (docs/SKINS_FROM_CLAUDE_DESIGN.md section 3).
 * Pure: no model calls, safe in the browser. Skins never see UiContext; questions are
 * addressed by their UI request id and the host maps answers back.
 */
export function buildSkinView(snapshot: HarnessSnapshot): SkinViewModel {
  const d = snapshot.device;
  const all = [...d.spaces, ...d.brief, ...d.discover, ...d.notices];
  const questions = new Map<string, SkinViewModel["questions"][number]>();
  for (const item of all) {
    if (!item.context || questions.has(item.context.uiRequestId)) continue;
    // A brief pointer to a blocking question stands in for it only when the question itself is gone.
    const pointer = item.component.id.startsWith("ask-");
    if (pointer && all.some((o) => o !== item && o.context?.uiRequestId === item.context?.uiRequestId)) continue;
    questions.set(item.context.uiRequestId, { id: item.context.uiRequestId, title: item.component.title ?? "Question", question: item.reason ?? "", component: item.component });
  }

  const docs = new Map(snapshot.memory.documents.filter((doc) => !doc.archivedAt).map((doc) => [doc.id, doc]));
  const documents: SkinViewModel["documents"] = [];
  for (const item of d.spaces) {
    const doc = !item.context && item.documentId ? docs.get(item.documentId) : undefined;
    if (!doc || documents.some((x) => x.id === doc.id)) continue;
    documents.push({
      id: doc.id,
      title: doc.title,
      description: doc.description,
      sections: doc.sections.map((s) => ({ ...s, items: s.kind === "list" || s.kind === "actions" ? s.body.split("\n").filter(Boolean) : [] })),
      processes: doc.processes.map((p) => ({ id: p.id, label: p.label, status: p.status, detail: p.detail })),
      results: doc.results,
      followUps: doc.followUps,
      actions: doc.suggestedActions.map((a) => ({ label: a.label })),
    });
  }

  const day = d.virtualTime.slice(0, 10);
  const today = snapshot.memory.calendar
    .filter((c) => c.status !== "cancelled" && c.start.slice(0, 10) === day)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((c) => ({ id: c.id, time: c.start.slice(11, 16), title: c.title, detail: c.location ?? "", kind: c.status === "penciled" ? ("penciled" as const) : ("event" as const) }));

  return {
    contract: 1,
    now: clockParts(d.virtualTime),
    locked: d.locked,
    location: d.location,
    theme: snapshot.settings.theme,
    island: { active: d.island.active, words: d.island.words ?? "", process: runningProcess(snapshot.memory.nodes) },
    brief: { headline: d.headline, summary: d.summary, updatedAt: d.briefUpdatedAt ?? "", items: [...d.notices.slice(0, 2), ...d.brief].map(row) },
    questions: [...questions.values()],
    documents,
    discover: d.discover.map(row),
    today,
    waiting: d.waiting.map((w) => ({ id: w.id, who: w.who, when: w.when, text: w.text, cta: w.callToAction })),
    apps: snapshot.tools.definitions.map((t) => ({ id: t.id, name: t.name, icon: t.name.slice(0, 1).toUpperCase() })),
    needs: d.needs,
    sample: false,
  };
}
