import type { VNode } from "./render.ts";

/** Mounts a child artboard for a dc-import host element. */
export interface ImportMounter {
  mount(host: HTMLElement, name: string, props: Record<string, unknown>): void;
  update(host: HTMLElement, name: string, props: Record<string, unknown>): void;
  unmount(host: HTMLElement): void;
}

const handlers = new WeakMap<Element, Map<string, EventListener>>();
const IMPORT_TAG = "dc-mount";

function setRef(ref: unknown, el: Element | null): void {
  if (typeof ref === "function") (ref as (e: Element | null) => void)(el);
  else if (ref && typeof ref === "object" && "current" in ref) (ref as { current: unknown }).current = el;
}

/** One listener per event type, dispatching to whatever handler the latest render bound. */
function syncEvents(el: Element, events: Map<string, EventListener>): void {
  let current = handlers.get(el);
  if (!current) {
    current = new Map();
    handlers.set(el, current);
  }
  for (const type of events.keys()) {
    if (current.has(type)) continue;
    el.addEventListener(type, (e) => handlers.get(el)?.get(type)?.call(el, e));
  }
  for (const type of current.keys()) if (!events.has(type)) current.delete(type);
  for (const [type, fn] of events) current.set(type, fn);
}

function create(v: VNode, mounter: ImportMounter): Node {
  if (v.kind === "text") return document.createTextNode(v.text);
  if (v.kind === "import") {
    const host = document.createElement(IMPORT_TAG);
    host.setAttribute("name", v.name);
    host.style.display = "contents";
    mounter.mount(host, v.name, v.props);
    return host;
  }
  const el = v.ns ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
  for (const [k, val] of v.attrs) el.setAttribute(k, val);
  syncEvents(el, v.events);
  patchChildren(el, v.children, mounter);
  setRef(v.ref, el);
  return el;
}

function sameKind(node: Node, v: VNode): boolean {
  if (v.kind === "text") return node.nodeType === 3;
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  if (v.kind === "import") return el.localName === IMPORT_TAG && el.getAttribute("name") === v.name;
  return el.localName !== IMPORT_TAG && (v.ns ? el.namespaceURI === v.ns && el.tagName === v.tag : el.namespaceURI === "http://www.w3.org/1999/xhtml" && el.localName === v.tag);
}

function unmountTree(node: Node, mounter: ImportMounter): void {
  if (node.nodeType !== 1) return;
  const el = node as HTMLElement;
  if (el.localName === IMPORT_TAG) mounter.unmount(el);
  for (const child of Array.from(el.children)) unmountTree(child, mounter);
}

function update(node: Node, v: VNode, mounter: ImportMounter): void {
  if (v.kind === "text") {
    if (node.textContent !== v.text) node.textContent = v.text;
    return;
  }
  const el = node as HTMLElement;
  if (v.kind === "import") return mounter.update(el, v.name, v.props);
  for (const a of Array.from(el.attributes)) if (!v.attrs.has(a.name)) el.removeAttribute(a.name);
  for (const [k, val] of v.attrs) if (el.getAttribute(k) !== val) el.setAttribute(k, val);
  // Keep what the user typed: the DOM property wins over a stale attribute.
  if (el instanceof HTMLInputElement && v.attrs.has("value") && el.value !== v.attrs.get("value") && document.activeElement !== el) el.value = v.attrs.get("value")!;
  syncEvents(el, v.events);
  patchChildren(el, v.children, mounter);
  setRef(v.ref, el);
}

/**
 * Brings a real DOM subtree in line with virtual nodes, reusing nodes by position. Reuse keeps
 * CSS transitions (the island's expand animation) and focus working across renders.
 */
export function patchChildren(parent: Element, vnodes: VNode[], mounter: ImportMounter): void {
  const existing = Array.from(parent.childNodes);
  vnodes.forEach((v, i) => {
    const node = existing[i];
    if (node && sameKind(node, v)) return update(node, v, mounter);
    const fresh = create(v, mounter);
    if (node) {
      unmountTree(node, mounter);
      parent.replaceChild(fresh, node);
    } else {
      parent.appendChild(fresh);
    }
  });
  for (const extra of existing.slice(vnodes.length)) {
    unmountTree(extra, mounter);
    extra.remove();
  }
}
