import type { SkinBriefRow, SkinCommand, SkinViewModel, UiComponentSpec, UiElement } from "@harness/core/skin";
import type { SkinCommandMessage, SkinStateMessage } from "./protocol.ts";

export type { SkinCommandMessage, SkinStateMessage } from "./protocol.ts";

type Screen = "discover" | "home" | "spaces";
type Doc = SkinViewModel["documents"][number];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string | null)[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c !== null) node.append(c);
  return node;
};

const ICONS: Record<string, string> = {
  event: "📅", message: "💬", task: "✓", travel: "🚗", place: "📍", shopping: "🛒",
  school: "🎓", health: "❤", money: "$", weather: "☁", info: "•", alert: "❓",
};

/**
 * The default skin (PLAN.md section 8). It renders skin contract v1 (SkinViewModel) and
 * nothing else, and sends every tap to the host as a SkinCommand. It runs inside an iframe,
 * so its styles never touch the harness.
 */
export class DefaultSkin {
  private view: SkinViewModel | null = null;
  private screen: Screen = "home";
  /** `q:<questionId>` or `d:<documentId>`. */
  private selectedSpace: string | null = null;
  /** Whether Home has asked for the weather since it was last shown. */
  private homeShown = false;
  /** What the last render drew; unchanged state is not redrawn. */
  private lastKey = "";
  /** Text the user is typing survives redraws: the input bar and every form field. */
  private inputDraft = "";
  private readonly drafts = new Map<string, string>();
  private recognition: SpeechLike | null = null;
  private readonly root: HTMLElement;
  private readonly post: (m: SkinCommandMessage) => void;

  constructor(root: HTMLElement, post: (m: SkinCommandMessage) => void) {
    this.root = root;
    this.post = post;
  }

  update(state: SkinStateMessage): void {
    this.view = state.view;
    document.documentElement.dataset.theme = state.view.theme;
    if (this.renderKey() !== this.lastKey) this.render();
  }

  /** Everything the screen shows. Time only matters on the lock screen, to the minute. */
  private renderKey(): string {
    if (!this.view) return "";
    const v = this.view;
    return JSON.stringify([{ ...v, now: v.locked ? v.now.time : "" }, this.screen, this.selectedSpace, this.recognition !== null]);
  }

  private send(command: SkinCommand): void {
    this.post({ type: "command", command });
  }

  private render(): void {
    if (!this.view) return;
    this.lastKey = this.renderKey();
    const v = this.view;
    // Keep focus and the caret on whatever field the user is typing in.
    const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    const focusKey = active?.dataset.key;
    const start = active?.selectionStart ?? null;
    const end = active?.selectionEnd ?? null;
    this.root.replaceChildren(v.locked ? this.lock(v) : this.unlocked(v));
    if (focusKey) {
      const again = this.root.querySelector<HTMLInputElement>(`[data-key="${CSS.escape(focusKey)}"]`);
      again?.focus();
      if (again && start !== null && end !== null && again.type === "text") again.setSelectionRange(start, end);
    }
    // Home shows the weather, which the agent looks up when asked (a skin need, see skin.json).
    const onHome = !v.locked && this.screen === "home";
    if (onHome && !this.homeShown) this.send({ type: "need", needId: "weather" });
    this.homeShown = onHome;
  }

  private island(v: SkinViewModel): HTMLElement {
    const p = v.island.process;
    const words = v.island.active ? v.island.words : p ? `${p.label}${p.eta ? ` · ${p.eta}` : ""}` : "";
    return h("div", { class: `island${v.island.active || p ? " active" : ""}`, "data-testid": "island" }, h("span", { class: "dot" }), words ? h("span", { class: "words" }, words) : null);
  }

  private lock(v: SkinViewModel): HTMLElement {
    const unlock = h("button", { class: "unlock", "data-testid": "unlock" }, "Tap to unlock");
    unlock.onclick = () => this.send({ type: "unlock" });
    const p = v.island.process;
    const live = p ? h("div", { class: "live-activity", "data-testid": "live-activity" }, h("div", { class: "title" }, p.label), h("div", { class: "line" }, [p.status, p.detail].filter(Boolean).join(": ")), p.progress === null ? null : h("div", { class: "bar" }, h("div", { class: "fill", style: `width:${Math.round(Math.min(1, Math.max(0, p.progress)) * 100)}%` }))) : null;
    return h("div", { class: "screen lock", "data-testid": "lock-screen" }, this.island(v), h("div", { class: "clock" }, h("div", { class: "time" }, v.now.time), h("div", { class: "date" }, v.now.date)), live, this.brief(v.brief.items.slice(0, 5)), unlock);
  }

  private brief(rows: SkinBriefRow[]): HTMLElement {
    const list = h("div", { class: "brief", "data-testid": "brief" });
    if (!rows.length) list.append(h("div", { class: "empty" }, "Nothing needs you right now."));
    for (const row of rows) {
      const card = h("button", { class: `brief-item${row.kind === "question" ? " needs" : ""}` }, h("div", { class: "title" }, h("span", { class: "icon" }, ICONS[row.icon] ?? "•"), row.title, row.badge ? h("span", { class: "badge" }, row.badge) : null), h("div", { class: "line" }, row.line));
      card.onclick = () => this.openRow(row);
      if (row.kind !== "question") {
        const dismiss = h("span", { class: "dismiss", title: "Not now", "data-testid": "dismiss" }, "×");
        dismiss.onclick = (e) => {
          e.stopPropagation();
          this.send({ type: "dismiss", itemId: row.id });
        };
        card.append(dismiss);
      }
      list.append(card);
    }
    return list;
  }

  private openRow(row: SkinBriefRow): void {
    this.send({ type: "open", itemId: row.id });
    this.screen = "spaces";
    this.selectedSpace = row.questionId ? `q:${row.questionId}` : row.documentId ? `d:${row.documentId}` : null;
    this.render();
  }

  private unlocked(v: SkinViewModel): HTMLElement {
    const body = this.screen === "home" ? this.home(v) : this.screen === "spaces" ? this.spaces(v) : this.discover(v);
    const nav = h("nav", { class: "pager" });
    for (const s of ["discover", "home", "spaces"] as Screen[]) {
      const b = h("button", { class: s === this.screen ? "on" : "", "data-testid": `nav-${s}` }, s[0]!.toUpperCase() + s.slice(1));
      b.onclick = () => ((this.screen = s), this.render());
      nav.append(b);
    }
    const lock = h("button", { class: "lock-btn", title: "Lock" }, "Lock");
    lock.onclick = () => this.send({ type: "lock" });
    return h("div", { class: `screen ${this.screen}` }, h("div", { class: "top" }, this.island(v), lock), body, nav);
  }

  private home(v: SkinViewModel): HTMLElement {
    const weather = v.needs.weather;
    const header = h(
      "div",
      { class: "day", "data-testid": "day" },
      v.brief.headline ? h("div", { class: "headline" }, v.brief.headline) : null,
      v.brief.summary ? h("div", { class: "summary" }, v.brief.summary) : null,
      weather?.status === "ready" ? h("div", { class: "weather", "data-testid": "weather" }, `${ICONS.weather} ${weather.values.now ?? ""} · ${weather.summary}`) : null,
    );
    const apps = h("div", { class: "apps" });
    for (const app of v.apps) apps.append(h("div", { class: "app" }, h("div", { class: "icon" }, app.icon), h("div", { class: "name" }, app.name)));
    const input = h("input", { placeholder: this.recognition ? "Listening…" : "Ask or tell your agent…", "data-testid": "input", "data-key": "home-input" }) as HTMLInputElement;
    input.value = this.inputDraft;
    input.oninput = () => (this.inputDraft = input.value);
    const sendText = () => {
      const text = input.value.trim();
      if (!text) return;
      this.send({ type: "say", text, via: "text" });
      input.value = "";
      this.inputDraft = "";
    };
    // Don't return a value here: `false` from an on* handler cancels the keystroke.
    input.onkeydown = (e) => {
      if (e.key === "Enter") sendText();
    };
    const send = h("button", { class: "send", "data-testid": "send" }, "↑");
    send.onclick = sendText;
    const mic = h("button", { class: `mic${this.recognition ? " listening" : ""}`, title: this.recognition ? "Stop listening" : "Speak", "data-testid": "mic" }, "🎙");
    mic.onclick = () => this.listen();
    const waiting = v.waiting.length ? h("div", { class: "waiting", "data-testid": "waiting" }, h("div", { class: "label" }, "Waiting on you")) : null;
    for (const w of v.waiting) {
      const b = h("button", { class: "chip" }, w.cta);
      b.onclick = () => this.send({ type: "act", itemId: w.id });
      waiting?.append(h("div", { class: "waiting-row" }, h("span", { class: "who" }, w.who), h("span", { class: "text" }, w.text), b));
    }
    return h("div", { class: "home-body" }, header, this.brief(v.brief.items), waiting, apps, h("div", { class: "input-bar" }, mic, input, send));
  }

  /**
   * Speech input: one utterance becomes exactly one message. Interim words show in the input
   * bar; the final transcript is sent once, when recognition ends. Pressing the mic again
   * stops listening instead of starting a second recognizer.
   */
  private listen(): void {
    if (this.recognition) {
      this.recognition.stop();
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => SpeechLike; webkitSpeechRecognition?: new () => SpeechLike };
    const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    const field = () => this.root.querySelector<HTMLInputElement>('[data-key="home-input"]');
    if (!Recognition) {
      const f = field();
      if (f) f.placeholder = "Speech input isn't available in this browser";
      return;
    }
    const rec = new Recognition();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = navigator.language;
    const finals: string[] = [];
    let sent = false;
    rec.onresult = (e) => {
      // Some browsers repeat the same final result; keep each distinct final phrase once.
      finals.length = 0;
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i]!;
        const text = (result[0]?.transcript ?? "").trim();
        if (!text) continue;
        if (result.isFinal) {
          if (finals.at(-1) !== text) finals.push(text);
        } else {
          interim = text;
        }
      }
      this.inputDraft = [...finals, interim].filter(Boolean).join(" ");
      const f = field();
      if (f) f.value = this.inputDraft;
    };
    const finish = () => {
      if (this.recognition !== rec) return;
      this.recognition = null;
      const text = finals.join(" ").trim();
      if (!sent && text) {
        sent = true;
        this.inputDraft = "";
        this.send({ type: "say", text, via: "voice" });
      }
      this.render();
    };
    rec.onend = finish;
    rec.onerror = finish;
    this.recognition = rec;
    this.render();
    rec.start();
  }

  private spaces(v: SkinViewModel): HTMLElement {
    const tabs: { key: string; label: string; draw: () => HTMLElement }[] = [
      ...v.questions.map((q) => ({ key: `q:${q.id}`, label: `❓ ${q.title}`, draw: () => this.component(q.component, q.id) })),
      ...v.documents.map((d) => ({ key: `d:${d.id}`, label: d.title, draw: () => this.document(d) })),
    ];
    if (!tabs.length) return h("div", { class: "spaces-body" }, h("div", { class: "empty" }, "No active projects yet."));
    const selected = tabs.find((t) => t.key === this.selectedSpace) ?? tabs[0]!;
    // Stay on this tab when new ones arrive, instead of jumping away mid-typing.
    this.selectedSpace = selected.key;
    const bar = h("div", { class: "tabs" });
    for (const t of tabs) {
      const b = h("button", { class: t === selected ? "on" : "" }, t.label);
      b.onclick = () => ((this.selectedSpace = t.key), this.render());
      bar.append(b);
    }
    return h("div", { class: "spaces-body" }, bar, selected.draw());
  }

  private document(d: Doc): HTMLElement {
    const card = h("div", { class: "card kind-document_view", "data-testid": "component-document_view" }, h("h3", {}, d.title));
    if (d.description) card.append(h("div", { class: "el text" }, h("p", {}, d.description)));
    for (const s of d.sections) {
      const label = h("div", { class: "label" }, s.title);
      if (s.items.length) {
        const ul = h("ul", {});
        for (const it of s.items) ul.append(h("li", {}, it));
        card.append(h("div", { class: "el list" }, label, ul));
      } else {
        card.append(h("div", { class: "el text" }, label, h("p", {}, s.body)));
      }
    }
    for (const p of d.processes) card.append(h("div", { class: "el progress" }, h("div", { class: "label" }, p.label), h("div", { class: "sub" }, `${p.status}: ${p.detail}`)));
    for (const [title, list] of [["Results", d.results], ["Follow-ups", d.followUps]] as const) {
      if (!list.length) continue;
      const ul = h("ul", {});
      for (const it of list) ul.append(h("li", {}, it));
      card.append(h("div", { class: "el list" }, h("div", { class: "label" }, title), ul));
    }
    if (d.actions.length) card.append(h("div", { class: "el list" }, h("div", { class: "label" }, "Suggested"), h("p", {}, d.actions.map((a) => a.label).join(" · "))));
    return card;
  }

  private discover(v: SkinViewModel): HTMLElement {
    const list = h("div", { class: "discover-body" });
    if (!v.discover.length) list.append(h("div", { class: "empty" }, "Nothing to discover yet."));
    for (const row of v.discover) {
      const card = h("div", { class: "card kind-card", "data-testid": "component-card" }, h("h3", {}, row.title), h("div", { class: "el text" }, h("p", {}, row.line)));
      card.onclick = () => this.openRow(row);
      list.append(card);
    }
    return list;
  }

  /** Renders a question the loop asked; answers go back by question id. */
  private component(spec: UiComponentSpec, questionId: string): HTMLElement {
    const card = h("div", { class: `card kind-${spec.kind}`, "data-testid": `component-${spec.kind}` });
    if (spec.title) card.append(h("h3", {}, spec.title));
    const values: Record<string, string> = {};
    const submit = (action: string, said: string) => {
      this.send({ type: "answer", questionId, action, values: { ...values }, said });
      for (const key of [...this.drafts.keys()]) if (key.startsWith(`${questionId}:`)) this.drafts.delete(key);
    };
    for (const e of spec.elements) card.append(this.element(e, values, submit, questionId));
    if (spec.primaryActionLabel && !spec.elements.some((e) => e.kind === "button")) {
      const b = h("button", { class: "primary" }, spec.primaryActionLabel);
      b.onclick = () => submit("submit", spec.primaryActionLabel ?? "submit");
      card.append(b);
    }
    return card;
  }

  private element(e: UiElement, values: Record<string, string>, submit: (action: string, said: string) => void, itemId: string): HTMLElement {
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
        const key = `${itemId}:${e.id}`;
        const input = h("input", { type: e.fieldType === "number" ? "number" : e.fieldType === "date" ? "date" : "text", "data-field": e.id, "data-key": key }) as HTMLInputElement;
        input.value = this.drafts.get(key) ?? e.value ?? "";
        values[e.id] = input.value;
        input.oninput = () => {
          values[e.id] = input.value;
          this.drafts.set(key, input.value);
        };
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
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onend: () => void;
  onerror: () => void;
  start(): void;
  stop(): void;
}

/** Boots the skin inside its iframe, talking to the parent page. */
export function mountSkin(root: HTMLElement): DefaultSkin {
  const skin = new DefaultSkin(root, (m) => window.parent.postMessage(m, "*"));
  window.addEventListener("message", (e: MessageEvent<SkinStateMessage>) => {
    if (e.data?.type === "state" && e.data.view?.contract === 1) skin.update(e.data);
  });
  window.parent.postMessage({ type: "ready" }, "*");
  return skin;
}
