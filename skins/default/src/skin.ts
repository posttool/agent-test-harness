import type { DeviceState, SurfaceItem, UiComponentSpec, UiElement } from "@harness/core/types";
import type { SkinCommandMessage, SkinStateMessage } from "./protocol.ts";

export type { SkinCommandMessage, SkinStateMessage } from "./protocol.ts";

type Screen = "discover" | "home" | "spaces";

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null) node.append(c);
  return node;
};

/**
 * The default skin (PLAN.md section 8). It renders DeviceState and nothing else, and sends
 * every tap back to the host as a runtime command. It runs inside an iframe, so its styles
 * never touch the harness.
 */
export class DefaultSkin {
  private state: SkinStateMessage | null = null;
  private screen: Screen = "home";
  private selectedSpace: string | null = null;
  private readonly root: HTMLElement;
  private readonly post: (m: SkinCommandMessage) => void;

  constructor(root: HTMLElement, post: (m: SkinCommandMessage) => void) {
    this.root = root;
    this.post = post;
  }

  update(state: SkinStateMessage): void {
    this.state = state;
    document.documentElement.dataset.theme = state.theme;
    this.render();
  }

  private send(command: SkinCommandMessage["command"]): void {
    this.post({ type: "command", command });
  }

  private render(): void {
    if (!this.state) return;
    const d = this.state.device;
    this.root.replaceChildren(d.locked ? this.lock(d) : this.unlocked(d));
  }

  private island(d: DeviceState): HTMLElement {
    const active = d.island.active;
    return h("div", { class: `island${active ? " active" : ""}`, "data-testid": "island" }, h("span", { class: "dot" }), active && d.island.words ? h("span", { class: "words" }, d.island.words) : null);
  }

  private time(d: DeviceState): { time: string; date: string } {
    const t = new Date(d.virtualTime);
    return {
      time: t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }),
      date: t.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
    };
  }

  private lock(d: DeviceState): HTMLElement {
    const { time, date } = this.time(d);
    const unlock = h("button", { class: "unlock", "data-testid": "unlock" }, "Tap to unlock");
    unlock.onclick = () => this.send({ type: "device", action: "unlock" });
    return h("div", { class: "screen lock", "data-testid": "lock-screen" }, this.island(d), h("div", { class: "clock" }, h("div", { class: "time" }, time), h("div", { class: "date" }, date)), this.brief(d), unlock);
  }

  private brief(d: DeviceState): HTMLElement {
    const items = [...d.notices.slice(0, 2), ...d.brief].slice(0, 5);
    const list = h("div", { class: "brief", "data-testid": "brief" });
    if (!items.length) list.append(h("div", { class: "empty" }, "Nothing needs you right now."));
    for (const item of items) {
      const text = item.component.elements.find((e) => e.text)?.text ?? item.reason ?? "";
      const card = h("button", { class: `brief-item${item.context ? " needs" : ""}` }, h("div", { class: "title" }, item.component.title ?? "Update"), h("div", { class: "line" }, text));
      card.onclick = () => this.openItem(item);
      if (!item.context) {
        const dismiss = h("span", { class: "dismiss", title: "Not now", "data-testid": "dismiss" }, "×");
        dismiss.onclick = (e) => {
          e.stopPropagation();
          this.send({ type: "dismiss", itemId: item.id });
        };
        card.append(dismiss);
      }
      list.append(card);
    }
    return list;
  }

  private openItem(item: SurfaceItem): void {
    if (item.topicId) this.send({ type: "seen", topicId: item.topicId });
    if (item.documentId && !item.context) this.send({ type: "open_document", documentId: item.documentId });
    if (this.state?.device.locked) this.send({ type: "device", action: "unlock" });
    this.screen = "spaces";
    this.selectedSpace = item.context ? (this.state?.device.spaces.find((s) => s.context?.uiRequestId === item.context?.uiRequestId)?.id ?? null) : null;
    this.render();
  }

  private unlocked(d: DeviceState): HTMLElement {
    const body = this.screen === "home" ? this.home(d) : this.screen === "spaces" ? this.spaces(d) : this.discover(d);
    const nav = h("nav", { class: "pager" });
    for (const s of ["discover", "home", "spaces"] as Screen[]) {
      const b = h("button", { class: s === this.screen ? "on" : "", "data-testid": `nav-${s}` }, s[0]!.toUpperCase() + s.slice(1));
      b.onclick = () => ((this.screen = s), this.render());
      nav.append(b);
    }
    const lock = h("button", { class: "lock-btn", title: "Lock" }, "Lock");
    lock.onclick = () => this.send({ type: "device", action: "lock" });
    return h("div", { class: `screen ${this.screen}` }, h("div", { class: "top" }, this.island(d), lock), body, nav);
  }

  private home(d: DeviceState): HTMLElement {
    const apps = h("div", { class: "apps" });
    for (const app of this.state?.apps ?? []) apps.append(h("div", { class: "app" }, h("div", { class: "icon" }, app.name.slice(0, 1)), h("div", { class: "name" }, app.name)));
    const input = h("input", { placeholder: "Ask or tell your agent…", "data-testid": "input" }) as HTMLInputElement;
    const sendText = () => {
      if (!input.value.trim()) return;
      this.send({ type: "user_text", text: input.value.trim(), source: "home input bar" });
      input.value = "";
    };
    input.onkeydown = (e) => e.key === "Enter" && sendText();
    const send = h("button", { class: "send", "data-testid": "send" }, "↑");
    send.onclick = sendText;
    const mic = h("button", { class: "mic", title: "Speak" }, "🎙");
    mic.onclick = () => this.listen(input);
    return h("div", { class: "home-body" }, this.brief(d), apps, h("div", { class: "input-bar" }, mic, input, send));
  }

  private listen(input: HTMLInputElement): void {
    const Recognition = (window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechLike }).webkitSpeechRecognition;
    if (!Recognition) return void (input.placeholder = "Speech input isn't available in this browser");
    const rec = new Recognition();
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text) this.send({ type: "user_text", text, source: "voice" });
    };
    rec.start();
  }

  private spaces(d: DeviceState): HTMLElement {
    const items = d.spaces;
    if (!items.length) return h("div", { class: "spaces-body" }, h("div", { class: "empty" }, "No active projects yet."));
    const selected = items.find((i) => i.id === this.selectedSpace) ?? items[0]!;
    const tabs = h("div", { class: "tabs" });
    for (const item of items) {
      const t = h("button", { class: item === selected ? "on" : "" }, item.context ? `❓ ${item.component.title ?? "Question"}` : (item.component.title ?? "Document"));
      t.onclick = () => ((this.selectedSpace = item.id), this.render());
      tabs.append(t);
    }
    return h("div", { class: "spaces-body" }, tabs, this.component(selected.component, selected));
  }

  private discover(d: DeviceState): HTMLElement {
    const list = h("div", { class: "discover-body" });
    if (!d.discover.length) list.append(h("div", { class: "empty" }, "Nothing to discover yet."));
    for (const item of d.discover) list.append(this.component(item.component, item));
    return list;
  }

  /** Renders a component; interactive only when it came from the loop (has a UiContext). */
  private component(spec: UiComponentSpec, item: SurfaceItem): HTMLElement {
    const card = h("div", { class: `card kind-${spec.kind}`, "data-testid": `component-${spec.kind}` });
    if (spec.title) card.append(h("h3", {}, spec.title));
    const values: Record<string, string> = {};
    const submit = (action: string, said: string) => {
      if (!item.context) return;
      this.send({ type: "ui_feedback", feedback: { context: item.context, action, values: { ...values }, at: new Date().toISOString() }, said });
    };
    for (const e of spec.elements) card.append(this.element(e, values, submit));
    if (spec.primaryActionLabel && item.context && !spec.elements.some((e) => e.kind === "button")) {
      const b = h("button", { class: "primary" }, spec.primaryActionLabel);
      b.onclick = () => submit("submit", spec.primaryActionLabel ?? "submit");
      card.append(b);
    }
    return card;
  }

  private element(e: UiElement, values: Record<string, string>, submit: (action: string, said: string) => void): HTMLElement {
    const label = e.label ? h("div", { class: "label" }, e.label) : null;
    switch (e.kind) {
      case "text":
        return h("div", { class: "el text" }, label, h("p", {}, e.text ?? e.value ?? ""));
      case "list": {
        const ul = h("ul", {});
        for (const it of e.items.length ? e.items : (e.text ?? "").split("\n").filter(Boolean)) ul.append(h("li", {}, it));
        return h("div", { class: "el list" }, label, ul);
      }
      case "form_field": {
        const input = h("input", { type: e.fieldType === "number" ? "number" : e.fieldType === "date" ? "date" : "text", "data-field": e.id }) as HTMLInputElement;
        input.value = e.value ?? "";
        values[e.id] = input.value;
        input.oninput = () => (values[e.id] = input.value);
        return h("label", { class: "el field" }, label ?? e.id, input);
      }
      case "choice": {
        const wrap = h("div", { class: "el choice" }, label);
        for (const option of e.items) {
          const chip = h("button", { class: "chip", "data-testid": "choice" }, option);
          chip.onclick = () => {
            values[e.id] = option;
            submit(e.id, option);
          };
          wrap.append(chip);
        }
        return wrap;
      }
      case "button": {
        const b = h("button", { class: e.id === "deny" ? "secondary" : "primary", "data-testid": `button-${e.id}` }, e.label ?? e.text ?? e.id);
        b.onclick = () => submit(e.id, e.label ?? e.id);
        return b;
      }
      case "progress": {
        const pct = Math.round(Math.min(1, Math.max(0, e.progress ?? 0)) * 100);
        return h("div", { class: "el progress" }, label, h("div", { class: "bar" }, h("div", { class: "fill", style: `width:${pct}%` })), e.text ? h("div", { class: "sub" }, e.text) : null);
      }
      case "link":
        return h("a", { class: "el link", href: e.url ?? "#", target: "_blank", rel: "noreferrer" }, e.label ?? e.url ?? "Link");
      case "image":
        return h("img", { class: "el image", src: e.url ?? "", alt: e.label ?? "" });
      case "map":
        return h("div", { class: "el map" }, "🗺 ", e.label ?? e.text ?? "Map");
      case "qr":
        return h("div", { class: "el qr" }, h("div", { class: "qr-code" }), h("div", { class: "sub" }, e.label ?? e.text ?? ""));
    }
  }
}

interface SpeechLike {
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  start(): void;
}

/** Boots the skin inside its iframe, talking to the parent page. */
export function mountSkin(root: HTMLElement): DefaultSkin {
  const skin = new DefaultSkin(root, (m) => window.parent.postMessage(m, "*"));
  window.addEventListener("message", (e: MessageEvent<SkinStateMessage>) => {
    if (e.data?.type === "state") skin.update(e.data);
  });
  window.parent.postMessage({ type: "ready" }, "*");
  return skin;
}
