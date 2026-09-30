import { SkinCommandSchema, type SkinBindingPlan, type SkinViewModel } from "@harness/core";
import { DcPlayer, segments } from "@harness/dc-runtime";
import { isContractPath, joinPath } from "./contract.ts";
import type { RewriteResult } from "./rewrite.ts";

export interface CheckResult {
  name: "format" | "contract" | "fidelity" | "stress" | "commands";
  ok: boolean;
  notes: string[];
}

/** A complete view model with plausible values, for stress and command checks. */
export function demoView(over: Partial<SkinViewModel> = {}): SkinViewModel {
  const row = (i: number, title = `Item ${i + 1}`) => ({ id: `item-${i}`, kind: "item" as const, title, line: `Line ${i + 1}`, cta: "Open", reason: "Because", icon: "info", badge: `${i + 1}m`, topicId: null, documentId: null, questionId: null });
  return {
    contract: 1,
    now: { iso: "2026-09-30T09:41:00.000Z", time: "09:41", date: "Wednesday, September 30", weekday: "Wednesday" },
    locked: false,
    location: "Home",
    theme: "dark",
    island: { active: false, words: "", process: { label: "Ride to work", status: "arriving", detail: "Blue hatchback", progress: 0.5, eta: "3 min" } },
    brief: { headline: "A calm day", summary: "Nothing urgent.", updatedAt: "2026-09-30T09:40:00.000Z", items: [row(0), row(1), row(2)] },
    questions: [],
    documents: [],
    discover: [row(10, "Discover one")].map((r) => ({ ...r, id: "disc-0" })),
    today: [{ id: "cal-0", time: "10:30", title: "Review", detail: "Room 4", kind: "event" }],
    waiting: [{ id: "wait-0", who: "Sam", when: "9:00", text: "Lunch?", cta: "Reply" }],
    apps: [{ id: "web", name: "Web", icon: "W" }],
    needs: { weather: { status: "ready", fields: ["now"], updatedAt: "2026-09-30T09:00:00.000Z", summary: "Sunny", values: { now: "20°" } } },
    sample: false,
    ...over,
  };
}

/** The stress views (§7 check 4): empty, crowded with long copy, nothing running, locked. */
export function stressViews(): Record<string, SkinViewModel> {
  const base = demoView();
  const long = "A very long title that keeps going well past what fits on one line of a phone screen";
  const many = Array.from({ length: 10 }, (_, i) => ({ ...base.brief.items[0]!, id: `item-${i}`, title: `${long} ${i}`, line: long }));
  return {
    empty: demoView({ brief: { headline: "", summary: "", updatedAt: "", items: [] }, discover: [], today: [], waiting: [], apps: [], needs: {}, island: { active: false, words: "", process: null } }),
    crowded: demoView({ brief: { ...base.brief, headline: long, summary: `${long}. ${long}.`, items: many }, today: many.map((m, i) => ({ id: `cal-${i}`, time: "10:00", title: m.title, detail: long, kind: "event" as const })), waiting: many.map((m, i) => ({ id: `wait-${i}`, who: long, when: "now", text: long, cta: "Reply" })) }),
    idle: demoView({ island: { active: true, words: "Thinking", process: null } }),
    locked: demoView({ locked: true }),
  };
}

const squash = (t: string) => t.split("\n").join(" ").split("\t").join(" ").split(" ").filter(Boolean).join(" ");

/** Structural comparison that ignores whitespace-only text and our data-skin-* markers. */
function sameTree(a: Node, b: Node, path: string): string | null {
  const kids = (n: Node) => Array.from(n.childNodes).filter((c) => c.nodeType === 1 || (c.nodeType === 3 && (c.textContent ?? "").trim() !== ""));
  if (a.nodeType === 3 || b.nodeType === 3) {
    const ta = (a.textContent ?? "").trim();
    const tb = (b.textContent ?? "").trim();
    return a.nodeType === b.nodeType && squash(ta) === squash(tb) ? null : `${path}: text "${ta.slice(0, 60)}" became "${tb.slice(0, 60)}"`;
  }
  if (a.nodeType === 1 && b.nodeType === 1) {
    const ea = a as Element;
    const eb = b as Element;
    if (ea.localName !== eb.localName) return `${path}: <${ea.localName}> became <${eb.localName}>`;
    const attrs = (e: Element) =>
      Array.from(e.attributes)
        .filter((x) => !x.name.startsWith("data-skin"))
        .map((x) => `${x.name}=${x.value}`)
        .sort()
        .join(" ");
    if (attrs(ea) !== attrs(eb)) return `${path} <${ea.localName}>: attributes differ (${attrs(ea).slice(0, 120)} → ${attrs(eb).slice(0, 120)})`;
  }
  const ka = kids(a);
  const kb = kids(b);
  if (ka.length !== kb.length) return `${path}: ${ka.length} children became ${kb.length}`;
  for (let i = 0; i < ka.length; i++) {
    const d = sameTree(ka[i]!, kb[i]!, `${path}/${(ka[i] as Element).localName ?? "#text"}[${i}]`);
    if (d) return d;
  }
  return null;
}

function render(file: string, artboards: Record<string, string>, extra: Record<string, unknown>): { root: HTMLElement; errors: string[]; player: DcPlayer } {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const errors: string[] = [];
  const player = new DcPlayer(root, { artboards, extraProps: extra, onError: (_f, e) => errors.push(e instanceof Error ? e.message : String(e)) });
  player.show(file);
  return { root, errors, player };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * The five checks for a bound artboard (docs/SKINS_FROM_CLAUDE_DESIGN.md section 7). Needs a
 * DOM: call inside withDom() outside the browser.
 */
export async function validateBound(r: RewriteResult, designSource: string, plan: SkinBindingPlan): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const file = r.file;

  // 1. Format: holes are dotted lookups, control-flow tags carry hint attributes, the file parses.
  const format: string[] = [];
  const doc = new DOMParser().parseFromString(r.source, "text/html");
  for (const el of Array.from(doc.querySelectorAll("x-dc *"))) {
    if ((el.localName === "sc-for" || el.localName === "sc-if") && !Array.from(el.attributes).some((a) => a.name.startsWith("hint-"))) format.push(`<${el.localName}> without hint-* attributes`);
    for (const a of Array.from(el.attributes)) {
      for (const seg of segments(a.value)) if (seg.kind === "hole" && !dotted(seg.path)) format.push(`hole "{{${seg.path}}}" is not a dotted lookup`);
    }
  }
  for (const seg of segments(doc.querySelector("x-dc")?.textContent ?? "")) if (seg.kind === "hole" && !dotted(seg.path)) format.push(`hole "{{${seg.path}}}" is not a dotted lookup`);
  results.push({ name: "format", ok: format.length === 0, notes: format });

  // 2. Contract: every bound path is in the contract, and every live region got bound.
  const contract: string[] = [];
  const needIds = plan.needs.map((n) => n.id);
  for (const b of r.bound) if (!isContractPath(b.path.split(".0.").join("[]."), needIds)) contract.push(`${b.anchor} binds ${b.path}, which is not in the contract`);
  for (const region of plan.regions) {
    if (region.role !== "live") continue;
    const got = region.fields.filter((f) => r.bound.some((b) => b.anchor === (f.anchor.startsWith("#") ? f.anchor.slice(1) : f.anchor)));
    if (got.length < region.fields.length) contract.push(`${region.label}: ${region.fields.length - got.length} of ${region.fields.length} fields unbound (${region.fields.filter((f) => !got.includes(f)).map((f) => joinPath(region.slot, f.path)).join(", ")})`);
  }
  results.push({ name: "contract", ok: contract.length === 0, notes: contract });

  // 3. Fidelity: with the designer's copy as data, the bound artboard renders the same DOM as the design.
  const a = render(file, { [file]: designSource }, {});
  const aClone = a.root.cloneNode(true);
  const b = render(file, { [file]: r.source }, {});
  const diff = sameTree(aClone, b.root, file);
  results.push({ name: "fidelity", ok: !diff && !b.errors.length, notes: [...b.errors, ...(diff ? [diff] : [])] });

  // 4. Stress: renders without errors, and lists show exactly as many rows as there are items.
  const stress: string[] = [];
  for (const [name, view] of Object.entries(stressViews())) {
    const s = render(file, { [file]: r.source }, { skin: view, send: () => {} });
    await tick();
    for (const e of s.errors) stress.push(`${name}: ${e}`);
  }
  results.push({ name: "stress", ok: stress.length === 0, notes: stress });

  // 5. Commands: every tap handler sends a valid skin command naming an id the view has.
  const commands: string[] = [];
  const view = demoView();
  const ids = new Set([...view.brief.items, ...view.discover, ...view.waiting].map((x) => x.id));
  for (const h of r.handlers) {
    const sent: unknown[] = [];
    const c = render(file, { [file]: r.source }, { skin: view, send: (cmd: unknown) => sent.push(cmd) });
    sent.length = 0; // mount-time need requests
    const target = c.root.querySelector(`[data-skin-anchor="${h.anchor}"]`);
    if (!target) {
      commands.push(`${h.anchor} (${h.command}) is not on screen with demo data`);
      continue;
    }
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const cmd = sent.find((x) => (x as { type?: string }).type !== "need") ?? sent[0];
    const parsed = SkinCommandSchema.safeParse(cmd);
    if (!parsed.success) commands.push(`${h.anchor} (${h.command}) sent ${JSON.stringify(cmd) ?? "nothing"}`);
    else if ("itemId" in parsed.data && !ids.has(parsed.data.itemId)) commands.push(`${h.anchor} sent an unknown item id ${parsed.data.itemId}`);
  }
  results.push({ name: "commands", ok: commands.length === 0, notes: commands });
  return results;
}

function dotted(path: string): boolean {
  const p = path.trim();
  if (p === "true" || p === "false" || p === "null" || !Number.isNaN(Number(p))) return true;
  if ((p.startsWith("'") && p.endsWith("'")) || (p.startsWith('"') && p.endsWith('"'))) return true;
  return p.split(".").every((k) => k.length > 0 && [...k].every((ch) => ch === "_" || ch === "$" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9")));
}
