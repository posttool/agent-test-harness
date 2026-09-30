import { hasHole, interpolate, lookup, wholeHole, type Scope } from "./holes.ts";

export type VNode =
  | { kind: "text"; text: string }
  | { kind: "el"; ns: string | null; tag: string; attrs: Map<string, string>; events: Map<string, EventListener>; ref: unknown; children: VNode[] }
  | { kind: "import"; name: string; props: Record<string, unknown> };

function camel(name: string): string {
  return name
    .split("-")
    .map((part, i) => (i === 0 ? part : part.slice(0, 1).toUpperCase() + part.slice(1)))
    .join("");
}

/** A value for an attribute or prop: raw when the whole value is one hole, else a string. */
function value(text: string, scope: Scope): unknown {
  const whole = wholeHole(text);
  if (whole !== null) return lookup(whole, scope);
  return hasHole(text) ? interpolate(text, scope) : text;
}

/**
 * Renders a template subtree against a scope, into virtual nodes. Implements the subset of
 * the .dc.html format that Claude Design artboards use: holes, sc-if, sc-for and dc-import.
 */
export function renderNodes(nodes: ArrayLike<Node>, scope: Scope): VNode[] {
  const out: VNode[] = [];
  for (const node of Array.from(nodes)) {
    if (node.nodeType === 3) {
      const text = node.textContent ?? "";
      out.push({ kind: "text", text: hasHole(text) ? interpolate(text, scope) : text });
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.localName;
    if (tag === "sc-if") {
      if (value(el.getAttribute("value") ?? "", scope)) out.push(...renderNodes(el.childNodes, scope));
      continue;
    }
    if (tag === "sc-for") {
      const list = value(el.getAttribute("list") ?? "", scope);
      const as = el.getAttribute("as") ?? "item";
      if (Array.isArray(list)) list.forEach((item, $index) => out.push(...renderNodes(el.childNodes, { ...scope, [as]: item, $index })));
      continue;
    }
    if (tag === "dc-import") {
      const props: Record<string, unknown> = {};
      for (const a of Array.from(el.attributes)) if (a.name !== "name" && !a.name.startsWith("hint-")) props[camel(a.name)] = value(a.value, scope);
      out.push({ kind: "import", name: el.getAttribute("name") ?? "", props });
      continue;
    }
    if (tag === "helmet") continue;
    const attrs = new Map<string, string>();
    const events = new Map<string, EventListener>();
    let ref: unknown = null;
    for (const a of Array.from(el.attributes)) {
      const name = a.name;
      if (name.startsWith("hint-")) continue;
      const v = value(a.value, scope);
      if (name === "ref") {
        ref = v;
        continue;
      }
      if (name.startsWith("on") && name.length > 2 && wholeHole(a.value) !== null) {
        if (typeof v === "function") events.set(name.slice(2).toLowerCase(), v as EventListener);
        continue;
      }
      // Like React: aria-* and data-* attributes spell booleans out; others drop false and keep true as present.
      if (typeof v === "boolean" && (name.startsWith("aria-") || name.startsWith("data-"))) {
        attrs.set(name, String(v));
        continue;
      }
      if (v === false || v === null || v === undefined) continue;
      attrs.set(name, v === true ? "" : typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    const ns = el.namespaceURI === "http://www.w3.org/1999/xhtml" ? null : el.namespaceURI;
    const kids = tag === "template" ? (el as HTMLTemplateElement).content.childNodes : el.childNodes;
    out.push({ kind: "el", ns, tag: ns ? el.tagName : tag, attrs, events, ref, children: renderNodes(kids, scope) });
  }
  return out;
}
