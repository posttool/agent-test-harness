/** A piece of a template string: literal text, or a `{{ path }}` hole. */
export type Segment = { kind: "text"; text: string } | { kind: "hole"; path: string };

/** Splits text into literal text and `{{ path }}` holes. Unclosed `{{` stays literal. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf("{{", at);
    const close = open < 0 ? -1 : text.indexOf("}}", open + 2);
    if (open < 0 || close < 0) {
      out.push({ kind: "text", text: text.slice(at) });
      break;
    }
    if (open > at) out.push({ kind: "text", text: text.slice(at, open) });
    out.push({ kind: "hole", path: text.slice(open + 2, close).trim() });
    at = close + 2;
  }
  return out;
}

export function hasHole(text: string): boolean {
  const open = text.indexOf("{{");
  return open >= 0 && text.indexOf("}}", open + 2) > open;
}

/** The single hole when the whole value is `{{ path }}` (raw values keep their type), else null. */
export function wholeHole(text: string): string | null {
  const parts = segments(text.trim());
  return parts.length === 1 && parts[0]!.kind === "hole" ? parts[0]!.path : null;
}

export type Scope = Record<string, unknown>;

function literal(path: string): { found: boolean; value: unknown } {
  if (path === "true") return { found: true, value: true };
  if (path === "false") return { found: true, value: false };
  if (path === "null") return { found: true, value: null };
  if (path === "undefined") return { found: true, value: undefined };
  const quote = path[0];
  if ((quote === "'" || quote === '"') && path.endsWith(quote) && path.length >= 2) return { found: true, value: path.slice(1, -1) };
  if (path !== "" && !Number.isNaN(Number(path))) return { found: true, value: Number(path) };
  return { found: false, value: undefined };
}

/**
 * Resolves a hole: a dotted lookup or a literal. The format has no expressions, so anything
 * else resolves to undefined, as it does in Claude Design.
 */
export function lookup(path: string, scope: Scope): unknown {
  const lit = literal(path);
  if (lit.found) return lit.value;
  let value: unknown = scope;
  for (const key of path.split(".")) {
    if (value === null || value === undefined) return undefined;
    value = (value as Record<string, unknown>)[key.trim()];
  }
  return value;
}

/** Text form of a value inside a string: null and undefined become empty. */
export function show(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function interpolate(text: string, scope: Scope): string {
  return segments(text)
    .map((s) => (s.kind === "text" ? s.text : show(lookup(s.path, scope))))
    .join("");
}
