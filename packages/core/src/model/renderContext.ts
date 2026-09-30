import type { ContextBlock } from "../types/ContextBlock.ts";

/** Renders context blocks as one user message. Formatting only; no interpretation. */
export function renderContext(blocks: readonly ContextBlock[]): string {
  if (blocks.length === 0) return "(no context)";
  return blocks.map((b) => `## ${b.kind}${b.title ? `: ${b.title}` : ""}\n${b.content}`).join("\n\n");
}
