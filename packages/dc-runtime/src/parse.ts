export interface PropSpec {
  editor?: string | null;
  default?: unknown;
  options?: unknown[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  section?: string;
}

/** One `.dc.html` artboard, parsed. The template is inert until a player renders it. */
export interface Artboard {
  file: string;
  title: string;
  lang: string;
  /** `<helmet>` children: styles and font links, applied to the document head. */
  helmet: Element[];
  /** The `<x-dc>` element without its helmet. */
  template: Element;
  /** The logic class source (`class Component extends DCLogic`), or empty. */
  script: string;
  props: Record<string, PropSpec>;
  /** `$preview` size, when declared. */
  preview: { width: number; height: number } | null;
}

export class ArtboardError extends Error {}

/** Parses a Claude Design artboard. Needs a DOM (the browser, or happy-dom in tests). */
export function parseArtboard(file: string, source: string, parser: DOMParser = new DOMParser()): Artboard {
  const doc = parser.parseFromString(source, "text/html");
  const root = doc.querySelector("x-dc");
  if (!root) throw new ArtboardError(`${file} has no <x-dc> element`);
  const helmetEl = root.querySelector(":scope > helmet");
  const helmet = helmetEl ? Array.from(helmetEl.children) : [];
  helmetEl?.remove();
  const scriptEl = doc.querySelector('script[type="text/x-dc"]');
  let props: Record<string, PropSpec> = {};
  const raw = scriptEl?.getAttribute("data-props");
  if (raw) {
    try {
      props = JSON.parse(raw) as Record<string, PropSpec>;
    } catch (error) {
      throw new ArtboardError(`${file} has data-props that are not JSON`, { cause: error });
    }
  }
  const preview = props.$preview as unknown as { width: number; height: number } | undefined;
  delete props.$preview;
  return {
    file,
    title: doc.title,
    lang: doc.documentElement.getAttribute("lang") ?? "en",
    helmet,
    template: root,
    script: scriptEl?.textContent ?? "",
    props,
    preview: preview ?? null,
  };
}

/** Each prop's declared default: what the Tweaks panel starts from. */
export function defaultProps(artboard: Artboard): Record<string, unknown> {
  return Object.fromEntries(Object.entries(artboard.props).filter(([, spec]) => spec && "default" in spec).map(([k, spec]) => [k, spec.default]));
}
