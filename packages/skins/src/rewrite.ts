import type { SkinBindingPlan } from "@harness/core";
import { joinPath } from "./contract.ts";

/** What binding one artboard produced (docs/SKINS_FROM_CLAUDE_DESIGN.md section 7). */
export interface RewriteResult {
  file: string;
  /** The bound artboard source. */
  source: string;
  /** The designer's copy in contract shape: what the bound artboard shows without live data. */
  sample: Record<string, unknown>;
  /** Contract paths bound, by anchor. */
  bound: { anchor: string; path: string }[];
  /** Anchors that got a skin command handler. */
  handlers: { anchor: string; command: string }[];
  needs: string[];
  problems: string[];
}

const LIST_SLOTS = ["brief.items", "questions", "documents", "discover", "today", "waiting", "apps"];

/** Every element of the template in document order, numbered like anchorize(): a1, a2, … (the helmet is not part of the template). */
export function anchorElements(xdc: Element): Map<string, Element> {
  const out = new Map<string, Element>();
  let n = 0;
  for (const el of Array.from(xdc.querySelectorAll("*"))) {
    if (el.closest("helmet")) continue;
    out.set(`a${++n}`, el);
  }
  return out;
}

const anchorId = (a: string) => (a.startsWith("#") ? a.slice(1) : a).trim();

const isIndex = (k: string) => k !== "" && String(Number(k)) === k;

/** Sets a dotted path, making arrays for numeric keys. Returns the value that was already there, if any. */
function setPath(target: Record<string, unknown>, path: string, value: unknown): unknown {
  const keys = path.split(".").filter(Boolean);
  let at = target as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    at[k] ??= isIndex(keys[i + 1]!) ? [] : {};
    at = at[k] as Record<string, unknown>;
  }
  const last = keys.at(-1)!;
  const before = at[last];
  at[last] = value;
  return before;
}

/** Child-index path from an ancestor to a descendant element. */
function relPath(from: Element, to: Element): number[] | null {
  const path: number[] = [];
  let at: Element | null = to;
  while (at && at !== from) {
    const parent: Element | null = at.parentElement;
    if (!parent) return null;
    path.unshift(Array.from(parent.children).indexOf(at));
    at = parent;
  }
  return at === from ? path : null;
}

function follow(from: Element, path: number[]): Element | null {
  let at: Element | undefined = from;
  for (const i of path) at = at?.children[i];
  return at ?? null;
}

/** The copy an element shows: its text, or failing that an attribute holding the sample. */
function textOf(el: Element): string {
  return (el.textContent ?? "").trim();
}

/**
 * Puts a hole where the sample copy is: the element's own text, a text node inside it, or an
 * attribute that contains it (aria-label, a style width). Returns false when the copy is not there.
 */
function placeHole(el: Element, sample: string, hole: string): boolean {
  const s = sample.trim();
  if (!s) return false;
  if (el.children.length === 0 && textOf(el) === s) {
    el.textContent = (el.textContent ?? "").split(s).join(hole);
    return true;
  }
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? "").includes(s)) {
      node.textContent = (node.textContent ?? "").split(s).join(hole);
      return true;
    }
  }
  if (el.children.length === 0 && textOf(el).includes(s)) {
    el.textContent = (el.textContent ?? "").split(s).join(hole);
    return true;
  }
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith("on") || a.name.startsWith("data-skin")) continue;
    if (a.value.includes(s)) {
      el.setAttribute(a.name, a.value.split(s).join(hole));
      return true;
    }
  }
  return false;
}

const js = (v: unknown) => JSON.stringify(v);

function commonAncestor(els: Element[]): Element {
  let at: Element | null = els[0]!;
  while (at && !els.every((e) => at!.contains(e))) at = at.parentElement;
  return at ?? els[0]!;
}

/** Tag structure, ignoring text and attributes: rows built the same way share it. */
function signature(el: Element): string {
  return `${el.localName}(${Array.from(el.children).map(signature).join(",")})`;
}

/** Where the samples sit: the element's text, or the first attribute holding them all. */
function sourceOf(el: Element, samples: string[]): { attr: string | null; value: string } | null {
  const text = textOf(el);
  if (samples.every((s) => text.includes(s.trim()))) return { attr: null, value: text };
  for (const a of Array.from(el.attributes)) if (!a.name.startsWith("on") && samples.every((s) => a.value.includes(s.trim()))) return { attr: a.name, value: a.value };
  return null;
}

function readSource(el: Element, attr: string | null): string {
  return attr ? (el.getAttribute(attr) ?? "") : textOf(el);
}

/** Splits text around the samples: literals between them, and which sample comes in which slot. */
function splitTemplate(value: string, samples: string[]): { literals: string[]; order: number[] } | null {
  const found = samples.map((s, i) => ({ i, at: value.indexOf(s.trim()), len: s.trim().length })).sort((a, b) => a.at - b.at);
  if (found.some((f) => f.at < 0)) return null;
  const literals: string[] = [];
  let pos = 0;
  for (const f of found) {
    if (f.at < pos) return null;
    literals.push(value.slice(pos, f.at));
    pos = f.at + f.len;
  }
  literals.push(value.slice(pos));
  return { literals, order: found.map((f) => f.i) };
}

/** The parts of a row's text between the literals, in slot order. */
function matchTemplate(text: string, literals: string[]): string[] | null {
  if (!text.startsWith(literals[0]!)) return null;
  let pos = literals[0]!.length;
  const parts: string[] = [];
  for (let k = 1; k < literals.length; k++) {
    const lit = literals[k]!;
    const next = k === literals.length - 1 ? (lit ? text.lastIndexOf(lit) : text.length) : text.indexOf(lit, pos);
    if (next < pos) return null;
    parts.push(text.slice(pos, next));
    pos = next + lit.length;
  }
  return parts;
}

/** Writes literals and holes back where the samples were. */
function writeSource(el: Element, attr: string | null, literals: string[], holes: string[]): void {
  let out = literals[0]!;
  holes.forEach((h, k) => (out += h + literals[k + 1]!));
  if (attr) {
    el.setAttribute(attr, out);
    return;
  }
  if (el.children.length === 0) {
    const raw = el.textContent ?? "";
    const trimmed = raw.trim();
    el.textContent = raw.split(trimmed).join(out);
    return;
  }
  const node = Array.from(el.childNodes).find((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
  if (node) node.textContent = (node.textContent ?? "").split((node.textContent ?? "").trim()).join(out);
}

/**
 * Attributes and text that differ between rows (outside the bound fields) become per-row
 * variant holes, so a divider on every row but the first survives the loop.
 */
function variantHoles(rows: Element[], as: string, fieldPaths: Set<string>): { key: string; values: string[] }[] {
  const out: { key: string; values: string[] }[] = [];
  if (rows.length < 2) return out;
  const lists = rows.map((r) => [r, ...Array.from(r.querySelectorAll("*"))]);
  lists[0]!.forEach((el0, idx) => {
    const path = relPath(rows[0]!, el0)?.join("/") ?? "";
    for (const a of Array.from(el0.attributes)) {
      if (a.name.startsWith("on") || a.name.startsWith("data-skin") || a.value.includes("{{")) continue;
      const values = lists.map((l) => l[idx]?.getAttribute(a.name) ?? "");
      if (values.every((v) => v === values[0])) continue;
      const key = `v${out.length}`;
      out.push({ key, values });
      el0.setAttribute(a.name, `{{${as}.${key}}}`);
    }
    if (fieldPaths.has(path) || el0.children.length) return;
    const texts = lists.map((l) => textOf(l[idx]!));
    if (texts.every((t) => t === texts[0]) || (el0.textContent ?? "").includes("{{")) return;
    const key = `v${out.length}`;
    out.push({ key, values: texts });
    el0.textContent = `{{${as}.${key}}}`;
  });
  return out;
}

function getPath(target: Record<string, unknown>, path: string): unknown {
  let at: unknown = target;
  for (const k of path.split(".")) at = at === null || at === undefined ? undefined : (at as Record<string, unknown>)[k];
  return at;
}

/**
 * Binds one Claude Design artboard to skin contract v1 using its analysis plan. Mechanical on
 * purpose: the model decided what binds where (analyze), and code does the rewrite, so the
 * bound artboard renders exactly like the design when it gets the design's own copy as data.
 *
 * - Literal copy becomes holes; repeated rows become one `<sc-for>` over the contract list.
 * - The logic class is kept (renamed `__Design`); a `Component` subclass adds the bindings
 *   and falls back to SAMPLE (the designer's copy) when no live data is passed.
 * - Taps get handlers that send skin commands through `props.send`.
 */
export function rewriteArtboard(file: string, designSource: string, plan: SkinBindingPlan, parser: DOMParser): RewriteResult {
  const problems: string[] = [];
  const doc = parser.parseFromString(designSource, "text/html");
  const xdc = doc.querySelector("x-dc");
  if (!xdc) throw new Error(`${file} has no <x-dc>`);
  const els = anchorElements(xdc);
  const el = (a: string) => els.get(anchorId(a)) ?? null;
  const sample: Record<string, unknown> = {};
  const bound: RewriteResult["bound"] = [];
  const handlers: RewriteResult["handlers"] = [];
  const singles: string[] = []; // generated `key: value` entries for the single bindings object
  const lists: { key: string; slot: string; fields: { key: string; path: string; sample: string }[]; handlers: { key: string; command: string }[]; variants: Record<string, string>[]; sampleCopy: Record<string, string>[] }[] = [];
  const rowOf = new Map<Element, { listKey: string; row: Element }>();
  const needs = new Set<string>();
  const mark = (e: Element, a: string) => e.setAttribute("data-skin-anchor", anchorId(a));

  for (const region of plan.regions) {
    if (region.role !== "live" || !region.fields.length) continue;
    const slot = region.slot.trim();
    if (slot.startsWith("needs.")) needs.add(slot.split(".")[1]!);
    for (const f of region.fields) if (joinPath(slot, f.path).startsWith("needs.")) needs.add(joinPath(slot, f.path).split(".")[1]!);
    const listSlot = LIST_SLOTS.find((l) => slot === l || slot === `${l}[]`);
    if (region.cardinality === "list" && listSlot) {
      const container = el(region.anchor);
      const fieldEls = region.fields.map((f) => el(f.anchor));
      if (!container || fieldEls.some((f) => !f || !container.contains(f))) {
        problems.push(`${region.label}: its fields are not inside the region, so the rows could not be found.`);
        continue;
      }
      if (fieldEls.some((f) => f!.closest("sc-for") && container.contains(f!.closest("sc-for")))) {
        problems.push(`${region.label}: already a loop over the design's own data; rebind it by hand in binding.json.`);
        continue;
      }
      // The row: the child of the region that holds every field, or the region itself.
      const common = commonAncestor(fieldEls as Element[]);
      let row: Element = common;
      if (common !== container) while (row.parentElement && row.parentElement !== container) row = row.parentElement;
      const paths = fieldEls.map((f) => relPath(row, f!)!);
      // Rows: the first and every following sibling built the same way, stopping at the first that isn't.
      const rows = [row];
      for (let sib = row.nextElementSibling; sib && signature(sib) === signature(row); sib = sib.nextElementSibling) rows.push(sib);
      const key = `rows_${anchorId(region.anchor)}`;
      const as = `skinrow_${anchorId(region.anchor)}`;
      // Each field's copy in every row: the whole text (or attribute), or a part of it split on the literal text around it.
      const fields = region.fields.map((f, i) => ({ key: `f${i}_${anchorId(f.anchor)}`, path: f.path, sample: f.sample, at: paths[i]! }));
      const values = rows.map(() => new Map<string, string>());
      const groups = new Map<string, typeof fields>();
      for (const f of fields) groups.set(f.at.join("/"), [...(groups.get(f.at.join("/")) ?? []), f]);
      for (const group of groups.values()) {
        const first = follow(row, group[0]!.at)!;
        const where = sourceOf(first, group.map((g) => g.sample));
        if (!where) {
          problems.push(`${region.label}: "${group.map((g) => g.sample).join('", "')}" not found at ${region.fields[fields.indexOf(group[0]!)]!.anchor}.`);
          continue;
        }
        const pieces = splitTemplate(where.value, group.map((g) => g.sample));
        rows.forEach((r, ri) => {
          const target = follow(r, group[0]!.at);
          const text = target ? readSource(target, where.attr) : "";
          const parts = pieces ? matchTemplate(text, pieces.literals) : null;
          group.forEach((g, gi) => values[ri]!.set(g.key, parts?.[pieces!.order[gi]!] ?? (group.length === 1 ? text : "")));
        });
        if (pieces) writeSource(first, where.attr, pieces.literals, pieces.order.map((o) => `{{${as}.${group[o]!.key}}}`));
        for (const g of group) {
          mark(first, region.fields[fields.indexOf(g)]!.anchor);
          bound.push({ anchor: anchorId(region.fields[fields.indexOf(g)]!.anchor), path: joinPath(listSlot, g.path) });
        }
      }
      // Rows that differ only in styling (a divider on all but the first) keep their look by position.
      const variants = variantHoles(rows, as, new Set(fields.map((f) => f.at.join("/"))));
      const sampleRows = rows.map((_, ri) => {
        const obj: Record<string, unknown> = { id: `sample-${anchorId(region.anchor)}-${ri}` };
        // Two fields on one path (an initial "M" and the name "Maya"): the fuller copy is the value.
        for (const f of [...fields].sort((x, y) => y.sample.length - x.sample.length)) if (!getPath(obj, f.path)) setPath(obj, f.path, values[ri]!.get(f.key) ?? "");
        return obj;
      });
      const existing = getPath(sample, listSlot);
      if (Array.isArray(existing) && existing.length) problems.push(`${listSlot} is bound as rows in more than one region; the sample keeps the last.`);
      setPath(sample, listSlot, sampleRows);
      for (const extra of rows.slice(1)) extra.remove();
      const loop = doc.createElement("sc-for");
      loop.setAttribute("list", `{{bind.${key}}}`);
      loop.setAttribute("as", as);
      loop.setAttribute("hint-placeholder-count", String(rows.length));
      row.replaceWith(loop);
      loop.appendChild(row);
      lists.push({ key, slot: listSlot, fields, handlers: [], variants: rows.map((_, ri) => Object.fromEntries(variants.map((v) => [v.key, v.values[ri]!]))), sampleCopy: rows.map((_, ri) => Object.fromEntries(fields.map((f) => [f.key, values[ri]!.get(f.key) ?? ""]))) });
      rowOf.set(row, { listKey: key, row });
      if (variants.length) problems.push(`${region.label}: ${variants.length} part(s) differ between rows and are kept by position.`);
      continue;
    }
    // One value per field. A list slot bound as "one" means its first item.
    const base = listSlot ? `${listSlot}.0` : slot;
    for (const f of region.fields) {
      const target = el(f.anchor);
      const path = listSlot ? `${base}.${f.path}` : joinPath(slot, f.path);
      if (!target) {
        problems.push(`${region.label}: no element ${f.anchor}.`);
        continue;
      }
      const key = `f_${anchorId(f.anchor)}_${singles.length}`;
      if (!placeHole(target, f.sample, `{{bind.b.${key}}}`)) {
        problems.push(`${region.label}: "${f.sample}" was not found at ${f.anchor}.`);
        continue;
      }
      mark(target, f.anchor);
      singles.push(`${js(key)}: __fmt(__get(s, ${js(path)}), ${js(f.sample)})`);
      const before = setPath(sample, path, f.sample);
      if (typeof before === "string" && before !== f.sample) problems.push(`${path} is shown twice with different copy ("${before}" and "${f.sample}"); the sample keeps the second.`);
      if (listSlot && !(getPath(sample, `${base}.id`))) setPath(sample, `${base}.id`, `sample-${anchorId(region.anchor)}`);
      bound.push({ anchor: anchorId(f.anchor), path });
    }
  }

  // Taps: skin commands through props.send. The design's own handlers and artboard links stay.
  const on: string[] = [];
  for (const i of plan.interactions) {
    if (i.command === "none" || i.command === "navigate") continue;
    const target = el(i.anchor);
    if (!target) {
      problems.push(`Tap ${i.anchor} (${i.command}): no such element.`);
      continue;
    }
    if (Array.from(target.attributes).some((a) => a.name.startsWith("on"))) continue;
    const href = target.getAttribute("href") ?? "";
    if ((i.command === "unlock" || i.command === "lock") && href.endsWith(".dc.html")) continue; // the host maps lock-screen links
    if (i.command === "say" || i.command === "answer") {
      problems.push(`Tap ${i.anchor} (${i.command}) needs an input the design doesn't have; left unbound.`);
      continue;
    }
    const inRow = [...rowOf.values()].find((r) => r.row.contains(target));
    const key = `on_${anchorId(i.anchor)}`;
    if (inRow) {
      lists.find((l) => l.key === inRow.listKey)!.handlers.push({ key, command: i.command });
      target.setAttribute("onClick", `{{skinrow_${inRow.listKey.slice(5)}.${key}}}`);
    } else {
      const list = LIST_SLOTS.find((l) => i.argsFrom.startsWith(l)) ?? "brief.items";
      const command =
        i.command === "unlock" || i.command === "lock"
          ? `{ type: ${js(i.command)} }`
          : i.command === "need"
            ? `{ type: "need", needId: ${js(i.argsFrom.split(".")[1] ?? i.argsFrom)} }`
            : `(__get(s, ${js(`${list}.0.id`)}) ? { type: ${js(i.command)}, itemId: __get(s, ${js(`${list}.0.id`)}) } : null)`;
      on.push(`${js(key)}: () => send(${command})`);
      target.setAttribute("onClick", `{{bind.on.${key}}}`);
    }
    mark(target, i.anchor);
    handlers.push({ anchor: anchorId(i.anchor), command: i.command });
  }

  const listCode = lists
    .map((l) => {
      const entries = [
        "id: it.id",
        `...__variant(${js(l.variants)}, i, arr.length)`,
        // Without live data each row shows its own designer copy verbatim.
        ...l.fields.map((f) => `${js(f.key)}: s === __SAMPLE ? ${js(l.sampleCopy.map((r) => r[f.key]))}[i] : __fmt(__get(it, ${js(f.path)}), ${js(f.sample)})`),
        ...l.handlers.map((h) => `${js(h.key)}: () => send({ type: ${js(h.command)}, itemId: it.id })`),
      ];
      return `      ${js(l.key)}: (__get(s, ${js(l.slot)}) || []).map((it, i, arr) => ({ ${entries.join(", ")} })),`;
    })
    .join("\n");

  const script = doc.querySelector('script[type="text/x-dc"]');
  const design = script?.textContent ?? "";
  const hasClass = design.includes("class Component extends DCLogic");
  if (design.trim() && !hasClass) problems.push("The logic class is not `class Component extends DCLogic`; bindings were added on a fresh class.");
  const renamed = hasClass ? design.split("class Component extends DCLogic").join("class __Design extends DCLogic") : "class __Design extends DCLogic {}";
  const generated = `
// ---- Bound to the agent harness skin contract v1 (generated by npm run skin:bind; edit binding.json, not this block) ----
const __SAMPLE = ${js(sample)};
const __NEEDS = ${js([...needs])};
function __get(o, path) { let v = o; for (const k of path.split(".")) { if (v === null || v === undefined) return undefined; v = v[k]; } return v; }
function __variant(rows, i, n) {
  if (!rows.length) return {};
  const last = rows.length - 1;
  const k = i === 0 ? 0 : i === n - 1 && last > 0 ? last : Math.max(Math.min(i, last - 1), Math.min(1, last));
  return rows[k] || rows[last];
}
function __fmt(v, sample) {
  if (v === null || v === undefined) return "";
  const text = String(v);
  if (String(sample).length === 1 && text.length > 1) return text.slice(0, 1).toUpperCase();
  if (typeof v === "number" && String(sample).trim().endsWith("%") && v <= 1) return Math.round(v * 100) + "%";
  return text;
}
class Component extends __Design {
  componentDidMount() {
    if (super.componentDidMount) super.componentDidMount();
    if (this.props.skin && this.props.send) for (const id of __NEEDS) this.props.send({ type: "need", needId: id });
  }
  renderVals() {
    const vals = super.renderVals() || {};
    const s = this.props.skin || __SAMPLE;
    const send = (c) => { if (c && this.props.send) this.props.send(c); };
    return { ...vals, bind: {
      b: { ${singles.join(", ")} },
      on: { ${on.join(", ")} },
${listCode}
    } };
  }
}
`;
  if (script) script.textContent = `${renamed}${generated}`;
  const source = `<!doctype html>\n${doc.documentElement.outerHTML}\n`;
  return { file, source, sample, bound, handlers, needs: [...needs], problems };
}
