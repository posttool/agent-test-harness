import { Window } from "happy-dom";

const NAMES = ["window", "document", "DOMParser", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTemplateElement", "CSS", "Event", "MouseEvent"] as const;

/**
 * Runs code that needs a browser DOM (the DC runtime) in Node, on happy-dom. In a test that
 * already has a DOM, it uses that one.
 */
export async function withDom<T>(fn: () => T | Promise<T>): Promise<T> {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.document !== "undefined") return fn();
  const win = new Window({ settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true } });
  const saved = NAMES.map((n) => [n, g[n]] as const);
  for (const n of NAMES) g[n] = n === "window" ? win : (win as unknown as Record<string, unknown>)[n];
  try {
    return await fn();
  } finally {
    for (const [n, v] of saved) g[n] = v;
    await win.happyDOM.close();
  }
}
