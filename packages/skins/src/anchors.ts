import type { Artboard } from "@harness/dc-runtime";

const KEEP_EMPTY = new Set(["img", "input", "br", "hr", "dc-import"]);

/**
 * Numbers every element of an artboard's template in document order (`#a1`, `#a2`…) and
 * prints compact markup for the analyzer: tags, anchors, attributes and text, with SVG
 * internals collapsed. The same artboard always gets the same numbers, so the rewrite step
 * finds the elements a plan names.
 */
export function anchorize(artboard: Artboard): { markup: string; anchors: Map<string, Element> } {
  const anchors = new Map<string, Element>();
  let n = 0;
  const lines: string[] = [];
  const walk = (el: Element, depth: number) => {
    const id = `a${++n}`;
    anchors.set(id, el);
    const pad = "  ".repeat(depth);
    const attrs = Array.from(el.attributes)
      .filter((a) => !a.name.startsWith("hint-"))
      .map((a) => ` ${a.name}="${a.value}"`)
      .join("");
    const tag = el.localName;
    if (tag === "svg") {
      // Count the collapsed children so numbering stays in step with a full walk.
      for (const d of Array.from(el.querySelectorAll("*"))) anchors.set(`a${++n}`, d);
      lines.push(`${pad}<svg #${id}${attrs} />`);
      return;
    }
    const kids = Array.from(el.childNodes);
    const text = kids
      .filter((k) => k.nodeType === 3)
      .map((k) => (k.textContent ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const elements = kids.filter((k) => k.nodeType === 1) as Element[];
    if (!elements.length) {
      lines.push(text || KEEP_EMPTY.has(tag) ? `${pad}<${tag} #${id}${attrs}>${text}</${tag}>` : `${pad}<${tag} #${id}${attrs} />`);
      return;
    }
    lines.push(`${pad}<${tag} #${id}${attrs}>${text ? ` ${text}` : ""}`);
    for (const child of elements) walk(child, depth + 1);
    lines.push(`${pad}</${tag}>`);
  };
  for (const child of Array.from(artboard.template.children)) walk(child, 0);
  return { markup: lines.join("\n"), anchors };
}
