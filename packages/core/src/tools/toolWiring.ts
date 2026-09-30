import type { CapabilityEffect, ContextProvider } from "../loop/AgentReasoningLoop.ts";
import type { ContextBlock } from "../types/ContextBlock.ts";
import type { ReasoningSession } from "../types/ReasoningSession.ts";
import type { Signal } from "../types/Signal.ts";
import type { ToolDiscoveryResult } from "../types/ToolDiscoveryResult.ts";
import type { ToolInvocationPlan } from "../types/ToolInvocationPlan.ts";
import type { UiFeedback } from "../types/UiFeedback.ts";
import type { UiRequest } from "../types/UiRequest.ts";
import type { ExecuteOutcome, ToolExecutor } from "./ToolExecutor.ts";
import type { ToolRegistry } from "./ToolRegistry.ts";
import type { SubscriptionManager } from "./SubscriptionManager.ts";
import type { WebBackend } from "./WebBackend.ts";

export interface ToolWiring {
  effects: Record<string, CapabilityEffect>;
  contextProviders: Record<string, ContextProvider>;
  onResume: (session: ReasoningSession, signal: Signal) => Promise<ContextBlock[]>;
}

const clip = (value: unknown, max = 1500) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** The confirmation card for confirm / always_ask functions. Presentation only. */
function approvalRequest(outcome: Extract<ExecuteOutcome, { kind: "needs_approval" }>): UiRequest {
  const editable = outcome.fn.oversight === "always_ask";
  return {
    purpose: "disambiguation",
    surface: "intent_space",
    blocking: true,
    question: `Allow ${outcome.tool.name} to ${outcome.fn.name}?`,
    rationale: `${outcome.fn.name} needs your ${editable ? "input on every argument" : "confirmation"} before it runs.`,
    component: {
      kind: "form",
      id: `approve-${outcome.call.id}`,
      title: `${outcome.tool.name}: ${outcome.fn.name}`,
      primaryActionLabel: "Approve",
      elements: [
        { kind: "text", id: "what", label: null, text: outcome.fn.description, items: [], value: null, url: null, progress: null, fieldType: null },
        ...Object.entries(outcome.args).map(([key, value]) => ({
          kind: editable ? ("form_field" as const) : ("text" as const),
          id: key,
          label: key,
          text: editable ? null : clip(value, 200),
          items: [],
          value: editable ? (typeof value === "string" ? value : JSON.stringify(value)) : null,
          url: null,
          progress: null,
          fieldType: editable ? ("text" as const) : null,
        })),
        { kind: "button", id: "approve", label: "Approve", text: null, items: [], value: null, url: null, progress: null, fieldType: null },
        { kind: "button", id: "deny", label: "Deny", text: null, items: [], value: null, url: null, progress: null, fieldType: null },
      ],
    },
  };
}

/** Connects tools to the loop: a tool catalog for context, discovery and use effects, and approvals. */
export function toolWiring(options: {
  registry: ToolRegistry;
  executor: ToolExecutor;
  subscriptions?: SubscriptionManager;
  web?: WebBackend;
}): ToolWiring {
  const { registry, executor, subscriptions, web } = options;

  const afterRun = async (outcome: ExecuteOutcome, session: ReasoningSession, documentId: string | null, showUi?: (r: UiRequest) => string): Promise<string> => {
    if (outcome.kind === "error") return `Tool call failed: ${outcome.error}`;
    if (outcome.kind === "needs_approval") return "Waiting for approval.";
    const lines = [`${outcome.tool.name}.${outcome.fn.name} returned: ${clip(outcome.result)}`];
    if (outcome.fn.longRunning && subscriptions) {
      const sub = await subscriptions.start(outcome.call, outcome.tool, outcome.fn, outcome.result, { sessionId: session.id, documentId });
      lines.push(`This started a real-world process; progress will arrive as tool_progress signals (subscription ${sub.id}). End the session and act when progress arrives.`);
    }
    if (outcome.fn.oversight === "auto_notify" && showUi) {
      showUi({
        purpose: "notice",
        surface: "contextual_brief",
        blocking: false,
        question: null,
        rationale: "auto_notify: tell the user after running",
        component: {
          kind: "notice",
          id: `notice-${outcome.call.id}`,
          title: `${outcome.tool.name}: ${outcome.fn.name}`,
          primaryActionLabel: null,
          elements: [{ kind: "text", id: "t", label: null, text: clip(outcome.result, 200), items: [], value: null, url: null, progress: null, fieldType: null }],
        },
      });
    }
    return lines.join(" ");
  };

  const use: CapabilityEffect = async (output, ctx) => {
    const plan = output as ToolInvocationPlan;
    const callCtx = { sessionId: ctx.session.id, documentId: plan.documentId };
    const outcome = await executor.execute(plan, callCtx);
    if (outcome.kind === "needs_approval") {
      const uiRequestId = ctx.showUi(approvalRequest(outcome), { documentId: plan.documentId });
      await executor.requestApproval(outcome, callCtx, uiRequestId);
      return { awaitUi: { uiRequestId }, note: `${outcome.fn.name} needs the user's ${outcome.fn.oversight === "always_ask" ? "input" : "confirmation"}; asked as ${uiRequestId}.` };
    }
    return { note: await afterRun(outcome, ctx.session, plan.documentId, (r) => ctx.showUi(r, { documentId: plan.documentId })) };
  };

  const discover: CapabilityEffect = async (output, ctx) => {
    const d = output as ToolDiscoveryResult;
    if (d.strategy === "recall") {
      const tool = d.toolId ? await registry.get(d.toolId) : undefined;
      return { note: tool ? `Use existing tool ${tool.id} (${tool.name}).` : `No tool ${d.toolId} exists.` };
    }
    if (d.strategy === "web_search") {
      if (!web) return { note: "Web search is not available." };
      const found = await web.search(d.searchQuery ?? d.rationale).catch((e: unknown) => ({ summary: `Search failed: ${String(e)}`, results: [] }));
      return { note: `Web search: ${found.summary}\n${found.results.map((r) => `- ${r.title} ${r.url}`).join("\n")}` };
    }
    if (d.strategy === "none" || !d.proposal) return { note: `No tool: ${d.rationale}` };
    try {
      const tool = await registry.registerProposal(d.proposal, ctx.session.id, d.strategy);
      return { note: `Registered tool ${tool.id} (${tool.name}) with functions: ${tool.functions.map((f) => `${f.name} [${f.oversight}]`).join(", ")}.` };
    } catch (error) {
      return { note: `Could not register the proposed tool: ${error instanceof Error ? error.message : String(error)}` };
    }
  };

  const catalog: ContextProvider = async () => [{ kind: "note", title: "Available tools", content: await registry.render() }];

  const onResume = async (session: ReasoningSession, signal: Signal): Promise<ContextBlock[]> => {
    if (!signal.uiRequestId) return [];
    const approval = await executor.approvalFor(signal.uiRequestId);
    if (!approval) return [];
    const feedback = (signal.data.feedback ?? null) as UiFeedback | null;
    const approved = feedback?.action === "approve";
    const edited: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(feedback?.values ?? {})) {
      try {
        edited[key] = JSON.parse(value);
      } catch {
        edited[key] = value;
      }
    }
    const outcome = await executor.resolveApproval(approval, approved, edited);
    return [{ kind: "step", title: `Approval ${approved ? "granted" : "denied"} for ${approval.toolId}.${approval.functionName}`, content: await afterRun(outcome, session, approval.documentId) }];
  };

  return {
    effects: { "tools.use": use, "tools.discover": discover },
    contextProviders: { "tools.use": catalog, "tools.discover": catalog },
    onResume,
  };
}
