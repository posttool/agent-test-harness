import type { Topic } from "../types/Topic.ts";
import type { MemoryStore } from "./MemoryStore.ts";

export interface MemoryViewOptions {
  /** How many non-topic nodes to include, most recently updated first. */
  maxNodes?: number;
  maxAttributeChars?: number;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function topicLine(t: Topic): string {
  const m = t.meta;
  const parts = [`[${t.id}] ${t.title} (category ${t.category}, stage ${t.stage})`];
  if (m.summary) parts.push(`summary: ${m.summary}`);
  if (m.dueDates.length) parts.push(`due: ${m.dueDates.map((d) => `${d.label || d.kind} ${d.value}`).join("; ")}`);
  if (m.triggers.length) parts.push(`triggers: ${m.triggers.map((r) => `${r.kind}${r.qualifier ? ` ${r.qualifier}` : ""} ${r.value}`).join("; ")}`);
  if (m.userOverrides.length) parts.push(`user overrides: ${m.userOverrides.map((o) => o.note || o.kind).join("; ")}`);
  if (m.newSinceLastSeen) parts.push(`new since last seen: ${m.newSinceLastSeen.summary}`);
  if (m.progress) {
    const done = m.progress.milestones.filter((x) => x.status === "done").length;
    parts.push(`progress: ${done}/${m.progress.milestones.length} done${m.progress.next ? `, next: ${m.progress.next}` : ""}${m.progress.stalled ? ", stalled" : ""}`);
  }
  parts.push(`updated ${m.lastUpdatedAt}${m.lastSeenAt ? `, seen ${m.lastSeenAt}` : ", never seen"}`);
  if (t.documentId) parts.push(`document ${t.documentId}`);
  return parts.join(" | ");
}

/** Renders the memory graph as text for the model. Formatting only; the model interprets it. */
export async function renderMemory(store: MemoryStore, options: MemoryViewOptions = {}): Promise<string> {
  const maxNodes = options.maxNodes ?? 150;
  const maxAttr = options.maxAttributeChars ?? 400;
  const [topics, documents, calendar, nodes, edges] = await Promise.all([store.topics(), store.documents(), store.calendar(), store.nodes(), store.edges()]);
  if (nodes.length === 0) return "Memory is empty.";

  const lines: string[] = ["### Topic index"];
  const children = (parentId: string | null) => topics.filter((t) => t.parentId === parentId).sort((a, b) => a.title.localeCompare(b.title));
  const walk = (parentId: string | null, depth: number) => {
    for (const t of children(parentId)) {
      lines.push(`${"  ".repeat(depth)}- ${topicLine(t)}`);
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  if (topics.length === 0) lines.push("(no topics)");

  lines.push("", "### Documents");
  for (const d of documents) {
    lines.push(`- [${d.id}] ${d.title} (topic ${d.topicId || "none"})${d.archivedAt ? " ARCHIVED" : ""}: ${d.description}`);
    for (const s of d.sections) lines.push(`  - ${s.title} (${s.kind}): ${clip(s.body, 300)}`);
    for (const p of d.processes) lines.push(`  - process ${p.id} "${p.label}": ${p.status} ${p.detail}`);
    if (d.results.length) lines.push(`  - results: ${d.results.join("; ")}`);
    if (d.followUps.length) lines.push(`  - follow-ups: ${d.followUps.join("; ")}`);
    if (d.suggestedActions.length) lines.push(`  - suggested actions: ${d.suggestedActions.map((a) => a.label).join("; ")}`);
  }
  if (documents.length === 0) lines.push("(no documents)");

  lines.push("", "### Calendar");
  for (const c of calendar) lines.push(`- [${c.id}] ${c.start}${c.end ? ` to ${c.end}` : ""} ${c.title} (${c.status})${c.location ? ` at ${c.location}` : ""}`);
  if (calendar.length === 0) lines.push("(empty)");

  const others = nodes
    .filter((n) => !["topic", "document", "calendar_entry"].includes(n.type))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, maxNodes);
  lines.push("", "### Other memory (most recently updated first)");
  for (const n of others) {
    const attrs = Object.keys(n.attributes).length ? ` ${clip(JSON.stringify(n.attributes), maxAttr)}` : "";
    lines.push(`- [${n.id}] ${n.type}${n.status !== "live" ? ` (${n.status})` : ""} · ${n.title}: ${n.summary}${attrs}`);
  }
  if (others.length === 0) lines.push("(none)");

  const shown = new Set([...topics.map((t) => t.id), ...documents.map((d) => d.id), ...calendar.map((c) => c.id), ...others.map((n) => n.id)]);
  const links = edges.filter((e) => shown.has(e.from) && shown.has(e.to) && !(e.type === "part_of" && topics.some((t) => t.id === e.from)));
  lines.push("", "### Links");
  for (const e of links) lines.push(`- ${e.from} -${e.type}-> ${e.to}`);
  if (links.length === 0) lines.push("(none)");
  return lines.join("\n");
}
