import type { CapabilityEffect, ContextProvider } from "../loop/AgentReasoningLoop.ts";
import type { ContextBlock } from "../types/ContextBlock.ts";
import type { MemoryMutationPlan } from "../types/MemoryMutationPlan.ts";
import type { MemoryStore } from "./MemoryStore.ts";
import { renderMemory, type MemoryViewOptions } from "./memoryView.ts";

/** Capabilities that need to see memory. */
export const MEMORY_AWARE_CAPABILITIES = ["memory.read", "memory.write", "memory.organize", "tools.discover", "tools.use", "ui.generate"];

export interface MemoryWiring {
  effects: Record<string, CapabilityEffect>;
  contextProviders: Record<string, ContextProvider>;
}

/**
 * Connects memory to the loop: capabilities get a view of the graph (plus "now": time and
 * place), and memory.write / memory.organize plans are applied to the store.
 */
export function memoryWiring(store: MemoryStore, options: { now?: () => ContextBlock[]; view?: MemoryViewOptions } = {}): MemoryWiring {
  const provider: ContextProvider = async () => [
    { kind: "memory", title: "Memory graph", content: await renderMemory(store, options.view) },
    ...(options.now?.() ?? []),
  ];
  const apply: CapabilityEffect = async (output, ctx) => {
    const plan = output as MemoryMutationPlan;
    const result = await store.applyPlan(plan, { sessionId: ctx.session.id, actor: "agent" });
    const lines = [`Applied ${result.changes.length} change(s): ${result.changes.join("; ") || "none"}.`];
    if (result.errors.length) lines.push(`Skipped: ${result.errors.join("; ")}.`);
    if (plan.needsUserConfirmation && plan.question) lines.push(`Needs the user's confirmation first: ${plan.question}`);
    return { note: lines.join(" ") };
  };
  return {
    effects: { "memory.write": apply, "memory.organize": apply },
    contextProviders: Object.fromEntries(MEMORY_AWARE_CAPABILITIES.map((id) => [id, provider])),
  };
}
