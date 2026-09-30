import type { ClientMessage } from "../types/ClientMessage.ts";
import type { HarnessSnapshot } from "../types/HarnessSnapshot.ts";
import { SkinCommandSchema } from "../types/SkinCommand.ts";
import type { SkinManifest } from "../types/SkinManifest.ts";

/**
 * Turns a skin's command into runtime messages. Anything a skin sends is untrusted: it is
 * parsed against SkinCommand, and ids it names must exist in the current snapshot.
 * Unknown ids produce no messages.
 */
export function skinCommandToMessages(input: unknown, snapshot: HarnessSnapshot, manifest: SkinManifest | null): ClientMessage[] {
  const parsed = SkinCommandSchema.safeParse(input);
  if (!parsed.success) return [];
  const c = parsed.data;
  const d = snapshot.device;
  const items = [...d.brief, ...d.notices, ...d.discover, ...d.spaces];
  const unlockFirst: ClientMessage[] = d.locked ? [{ type: "device", action: "unlock" }] : [];
  const open = (itemId: string): ClientMessage[] => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return [];
    return [
      ...unlockFirst,
      ...(item.topicId ? [{ type: "seen" as const, topicId: item.topicId }] : []),
      ...(item.documentId && !item.context ? [{ type: "open_document" as const, documentId: item.documentId }] : []),
    ];
  };
  switch (c.type) {
    case "unlock":
    case "lock":
      return [{ type: "device", action: c.type }];
    case "say":
      return [{ type: "user_text", text: c.text, source: c.via === "voice" ? "voice" : "home input bar" }];
    case "answer": {
      const asked = items.filter((i) => i.context?.uiRequestId === c.questionId);
      const item = asked.find((i) => !i.component.id.startsWith("ask-")) ?? asked[0];
      if (!item?.context) return [];
      return [{ type: "ui_feedback", feedback: { context: item.context, action: c.action, values: c.values, at: d.virtualTime }, said: c.said }];
    }
    case "open":
      return open(c.itemId);
    case "act": {
      const waiting = d.waiting.find((w) => w.id === c.itemId);
      if (waiting) return [{ type: "user_text", text: `${waiting.callToAction}: ${waiting.who} is waiting on "${waiting.text}".`, source: "skin action" }];
      return open(c.itemId);
    }
    case "dismiss":
      return items.some((i) => i.id === c.itemId) ? [{ type: "dismiss", itemId: c.itemId }] : [];
    case "need": {
      const need = manifest?.needs.find((n) => n.id === c.needId);
      return need ? [{ type: "skin_need", need }] : [];
    }
  }
}
