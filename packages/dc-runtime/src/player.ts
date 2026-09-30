import { defaultProps, parseArtboard, type Artboard } from "./parse.ts";
import { patchChildren, type ImportMounter } from "./patch.ts";
import { renderNodes } from "./render.ts";

type State = Record<string, unknown>;

/**
 * The base class artboard logic extends. Mirrors the parts of a React class component the
 * format documents: props, state, setState, forceUpdate and the lifecycle hooks.
 */
export class DCLogic {
  props: Record<string, unknown>;
  state: State = {};
  /** Set by the player; schedules a render. */
  __invalidate: () => void = () => {};

  constructor(props: Record<string, unknown>) {
    this.props = props;
  }

  setState(partial: State | ((state: State, props: Record<string, unknown>) => State | null) | null, callback?: () => void): void {
    const next = typeof partial === "function" ? partial(this.state, this.props) : partial;
    if (next) this.state = { ...this.state, ...next };
    this.__invalidate();
    if (callback) queueMicrotask(callback);
  }

  forceUpdate(): void {
    this.__invalidate();
  }

  renderVals(): Record<string, unknown> {
    return {};
  }
}

type LogicClass = new (props: Record<string, unknown>) => DCLogic & {
  componentDidMount?: () => void;
  componentDidUpdate?: (prevProps: Record<string, unknown>, prevState: State) => void;
  componentWillUnmount?: () => void;
};

/**
 * Compiles an artboard's logic class. The code is untrusted design content: callers must run
 * the player inside a sandboxed iframe (docs/SKINS_FROM_CLAUDE_DESIGN.md section 4).
 */
function compile(artboard: Artboard): LogicClass {
  if (!artboard.script.trim()) return DCLogic as LogicClass;
  const factory = new Function("DCLogic", `"use strict";\n${artboard.script}\nreturn typeof Component === "undefined" ? DCLogic : Component;`) as (base: typeof DCLogic) => LogicClass;
  return factory(DCLogic);
}

/** A mounted artboard: its logic instance and the element it renders into. */
class Instance {
  readonly logic: InstanceType<LogicClass>;
  private scheduled = false;
  private mounted = false;
  private readonly artboard: Artboard;
  private readonly host: HTMLElement;
  private readonly player: DcPlayer;

  constructor(artboard: Artboard, host: HTMLElement, props: Record<string, unknown>, player: DcPlayer) {
    this.artboard = artboard;
    this.host = host;
    this.player = player;
    const Logic = player.logicFor(artboard);
    this.logic = new Logic(props);
    this.logic.props = props;
    this.logic.__invalidate = () => this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.mounted) this.render();
    });
  }

  setProps(props: Record<string, unknown>): void {
    const prevProps = this.logic.props;
    this.logic.props = props;
    this.render(prevProps);
  }

  render(prevProps: Record<string, unknown> = this.logic.props, prevState: State = this.logic.state): void {
    let vals: Record<string, unknown>;
    try {
      vals = this.logic.renderVals() ?? {};
    } catch (error) {
      this.player.report(this.artboard.file, error);
      return;
    }
    // Holes see the props (tweaks bind directly) and, over them, what renderVals() returns.
    patchChildren(this.host, renderNodes(this.artboard.template.childNodes, { ...this.logic.props, ...vals }), this.player.mounter);
    if (!this.mounted) {
      this.mounted = true;
      this.logic.componentDidMount?.();
    } else {
      this.logic.componentDidUpdate?.(prevProps, prevState);
    }
  }

  unmount(): void {
    this.mounted = false;
    this.logic.componentWillUnmount?.();
  }
}

export interface PlayerOptions {
  /** Artboard sources keyed by file name, e.g. `Main.dc.html`. */
  artboards: Record<string, string>;
  /** Tweak values over each artboard's declared defaults. */
  tweaks?: Record<string, unknown>;
  /** Extra props every artboard gets (the skin view model goes here as `skin`). */
  extraProps?: Record<string, unknown>;
  /** Called when a link moves Play to another artboard. Return false to cancel. */
  onNavigate?: (from: string | null, to: string) => boolean | void;
  onError?: (file: string, error: unknown) => void;
}

/**
 * Plays a Claude Design canvas: one artboard at a time, links move between them, child
 * artboards mount through dc-import. Our own implementation of the format's documented subset.
 */
export class DcPlayer {
  private readonly parsed = new Map<string, Artboard>();
  private readonly classes = new Map<string, LogicClass>();
  private readonly imports = new WeakMap<HTMLElement, Instance>();
  private readonly root: HTMLElement;
  private readonly o: PlayerOptions;
  private tweaks: Record<string, unknown>;
  private extra: Record<string, unknown>;
  private current: { file: string; instance: Instance } | null = null;
  readonly mounter: ImportMounter;

  constructor(root: HTMLElement, options: PlayerOptions) {
    this.root = root;
    this.o = options;
    this.tweaks = options.tweaks ?? {};
    this.extra = options.extraProps ?? {};
    this.mounter = {
      mount: (host, name, props) => {
        const artboard = this.artboard(`${name}.dc.html`);
        if (!artboard) return;
        this.applyHelmet(artboard, false);
        const instance = new Instance(artboard, host, this.propsFor(artboard, props), this);
        this.imports.set(host, instance);
        instance.render();
      },
      update: (host, name, props) => {
        const instance = this.imports.get(host);
        const artboard = this.artboard(`${name}.dc.html`);
        if (instance && artboard) instance.setProps(this.propsFor(artboard, props));
      },
      unmount: (host) => {
        this.imports.get(host)?.unmount();
        this.imports.delete(host);
      },
    };
    root.addEventListener("click", (e) => this.onClick(e));
  }

  get file(): string | null {
    return this.current?.file ?? null;
  }

  files(): string[] {
    return Object.keys(this.o.artboards);
  }

  artboard(file: string): Artboard | null {
    const cached = this.parsed.get(file);
    if (cached) return cached;
    const source = this.o.artboards[file];
    if (source === undefined) return null;
    const artboard = parseArtboard(file, source);
    this.parsed.set(file, artboard);
    return artboard;
  }

  logicFor(artboard: Artboard): LogicClass {
    let cls = this.classes.get(artboard.file);
    if (!cls) {
      cls = compile(artboard);
      this.classes.set(artboard.file, cls);
    }
    return cls;
  }

  report(file: string, error: unknown): void {
    if (this.o.onError) this.o.onError(file, error);
    else console.error(`[dc-runtime] ${file}:`, error);
  }

  private propsFor(artboard: Artboard, own: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...defaultProps(artboard), ...this.tweaks, ...this.extra, ...own };
  }

  /** Shows an artboard. Its state starts fresh, as each artboard keeps its own state in Play. */
  show(file: string): void {
    const artboard = this.artboard(file);
    if (!artboard) return this.report(file, new Error(`No artboard ${file}`));
    this.current?.instance.unmount();
    this.root.replaceChildren();
    this.applyHelmet(artboard, true);
    document.documentElement.lang = artboard.lang;
    try {
      const instance = new Instance(artboard, this.root, this.propsFor(artboard), this);
      this.current = { file, instance };
      instance.render();
    } catch (error) {
      this.current = null;
      this.report(file, error);
    }
  }

  /** New tweak values or extra props: re-render the current artboard with them. */
  setProps(tweaks: Record<string, unknown> | null, extra: Record<string, unknown> | null = null): void {
    if (tweaks) this.tweaks = tweaks;
    if (extra) this.extra = extra;
    const current = this.current;
    if (!current) return;
    const artboard = this.artboard(current.file);
    if (artboard) current.instance.setProps(this.propsFor(artboard));
  }

  /** Links between artboards move Play; in-page anchors and other links behave as usual. */
  private onClick(e: Event): void {
    const target = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!target) return;
    const href = target.getAttribute("href") ?? "";
    if (!href.endsWith(".dc.html")) return;
    e.preventDefault();
    const to = href.startsWith("/") ? href.slice(1) : href.startsWith("./") ? href.slice(2) : href;
    if (this.o.onNavigate?.(this.file, to) === false) return;
    this.show(to);
  }

  /** Puts an artboard's helmet (fonts, styles) in the head. A new screen replaces the last one's. */
  private applyHelmet(artboard: Artboard, replace: boolean): void {
    if (replace) for (const old of Array.from(document.head.querySelectorAll("[data-dc-helmet]"))) old.remove();
    if (document.head.querySelector(`[data-dc-helmet="${CSS.escape(artboard.file)}"]`)) return;
    for (const node of artboard.helmet) {
      const copy = document.importNode(node, true) as Element;
      copy.setAttribute("data-dc-helmet", artboard.file);
      document.head.appendChild(copy);
    }
  }
}
