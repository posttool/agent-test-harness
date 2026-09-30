// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DcPlayer, interpolate, lookup, parseArtboard, segments, wholeHole } from "../src/index.ts";

const DESIGN = join(import.meta.dirname, "..", "..", "..", "skins", "liquid-glass", "design");
const liquidGlass = Object.fromEntries(readdirSync(DESIGN).filter((f) => f.endsWith(".dc.html")).map((f) => [f, readFileSync(join(DESIGN, f), "utf8")]));
const tick = () => new Promise((r) => setTimeout(r, 0));

const board = (body: string, script = "", props = "{}") =>
  `<!doctype html><html lang="en"><head><title>T</title></head><body><x-dc><helmet><style>.x{color:red}</style></helmet>${body}</x-dc>` +
  `<script type="text/x-dc" data-dc-script data-props='${props}'>${script}</script></body></html>`;

let root: HTMLElement;
beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "<div id=root></div>";
  root = document.getElementById("root")!;
});

describe("holes", () => {
  it("splits text into literal text and holes, and resolves dotted lookups and literals only", () => {
    expect(segments("a {{ b.c }} d")).toEqual([
      { kind: "text", text: "a " },
      { kind: "hole", path: "b.c" },
      { kind: "text", text: " d" },
    ]);
    expect(segments("no {{ close")).toEqual([{ kind: "text", text: "no {{ close" }]);
    expect(wholeHole(" {{ x }} ")).toBe("x");
    expect(wholeHole("a {{ x }}")).toBeNull();
    const scope = { user: { name: "Ada" }, n: 3 };
    expect(lookup("user.name", scope)).toBe("Ada");
    expect(lookup("true", scope)).toBe(true);
    expect(lookup("'hi'", scope)).toBe("hi");
    expect(lookup("n + 1", scope)).toBeUndefined();
    expect(interpolate("{{user.name}} has {{n}} {{missing}}", scope)).toBe("Ada has 3 ");
  });
});

describe("DcPlayer", () => {
  it("renders holes, sc-if, sc-for and events, and re-renders in place on setState", async () => {
    const script = `class Component extends DCLogic {
      constructor(p) { super(p); this.state = { n: 0 }; }
      renderVals() {
        return { title: this.props.title, n: this.state.n, many: this.state.n > 1,
          items: ['a', 'b'].map((x) => ({ x })), bump: () => this.setState({ n: this.state.n + 1 }) };
      }
    }`;
    const player = new DcPlayer(root, { artboards: { "A.dc.html": board(`<h1 style="color: {{accent}}">{{title}}</h1><button onClick="{{bump}}">{{n}}</button><sc-if value="{{many}}"><p id=many>many</p></sc-if><ul><sc-for list="{{items}}" as="it"><li>{{$index}}:{{it.x}}</li></sc-for></ul>`, script, '{"title":{"editor":"text","default":"Hello"},"accent":{"editor":"color","default":"#f00"}}') } });
    player.show("A.dc.html");
    expect(root.querySelector("h1")!.textContent).toBe("Hello");
    expect(root.querySelector("h1")!.getAttribute("style")).toBe("color: #f00");
    expect(Array.from(root.querySelectorAll("li")).map((l) => l.textContent)).toEqual(["0:a", "1:b"]);
    expect(document.head.querySelector("style[data-dc-helmet]")!.textContent).toBe(".x{color:red}");
    const button = root.querySelector("button")!;
    button.click();
    button.click();
    await tick();
    expect(root.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("2");
    expect(root.querySelector("#many")).not.toBeNull();
  });

  it("applies tweaks over declared defaults", () => {
    const player = new DcPlayer(root, { artboards: { "A.dc.html": board("<p>{{title}}</p>", "", '{"title":{"editor":"text","default":"Hello"}}') }, tweaks: { title: "Tweaked" } });
    player.show("A.dc.html");
    expect(root.textContent).toBe("Tweaked");
    player.setProps({ title: "Again" });
    expect(root.textContent).toBe("Again");
  });

  it("mounts child artboards with dc-import and passes props", () => {
    const player = new DcPlayer(root, {
      artboards: {
        "A.dc.html": board(`<div><dc-import name="Card" label="{{label}}" hint-size="10px,10px"></dc-import></div>`, "class Component extends DCLogic { renderVals() { return { label: 'Hi' }; } }"),
        "Card.dc.html": board("<b>{{label}}!</b>", "class Component extends DCLogic { renderVals() { return { label: this.props.label }; } }"),
      },
    });
    player.show("A.dc.html");
    expect(root.querySelector("b")!.textContent).toBe("Hi!");
  });

  it("reports a broken logic class instead of throwing", () => {
    const errors: string[] = [];
    const player = new DcPlayer(root, { artboards: { "A.dc.html": board("<p>x</p>", "class Component extends DCLogic { renderVals() { throw new Error('boom'); } }") }, onError: (f, e) => errors.push(`${f}: ${String(e)}`) });
    player.show("A.dc.html");
    expect(errors).toEqual(["A.dc.html: Error: boom"]);
  });
});

describe("the Liquid Glass reference design", () => {
  it("parses all three artboards with their tweaks", () => {
    const main = parseArtboard("Main.dc.html", liquidGlass["Main.dc.html"]!);
    expect(main.title).toBe("Lock Screen");
    expect(Object.keys(main.props)).toEqual(["font", "wallpaper", "orb1", "orb2", "orb3", "ground", "accent", "glass"]);
    expect(main.preview).toEqual({ width: 390, height: 844 });
    expect(main.helmet.map((n) => n.localName)).toEqual(["link", "link", "style"]);
  });

  it("renders the lock screen with its original copy, expands the island, and follows links", async () => {
    const moves: string[] = [];
    const player = new DcPlayer(root, { artboards: liquidGlass, onNavigate: (from, to) => void moves.push(`${from}→${to}`) });
    player.show("Main.dc.html");
    expect(root.textContent).toContain("9:41");
    expect(root.textContent).toContain("Design review at 10:30");
    expect(root.textContent).not.toContain("Grey sedan");
    const island = root.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    expect(island.style.width).toBe("200px");
    island.click();
    await tick();
    expect(root.querySelector("button[aria-expanded]")).toBe(island);
    expect(island.getAttribute("aria-expanded")).toBe("true");
    expect(island.style.width).toBe("362px");
    expect(root.textContent).toContain("Grey sedan · 7KXW219");
    root.querySelector<HTMLAnchorElement>('a[href="Home.dc.html"]')!.click();
    expect(player.file).toBe("Home.dc.html");
    expect(document.documentElement.lang).toBe("en");
    root.querySelector<HTMLAnchorElement>('a[href="Brief.dc.html"]')!.click();
    expect(player.file).toBe("Brief.dc.html");
    expect(moves).toEqual(["Main.dc.html→Home.dc.html", "Home.dc.html→Brief.dc.html"]);
  });

  it("changes with tweaks: wallpaper, accent and glass", () => {
    const player = new DcPlayer(root, { artboards: liquidGlass, tweaks: { wallpaper: "Glacier", accent: "#7CF5C8", glass: 8 } });
    player.show("Main.dc.html");
    const html = root.innerHTML;
    expect(html).toContain("#04111b");
    expect(html).toContain("#7CF5C8");
    expect(html).toContain("blur(8px)");
  });

  it("toggles the Brief's suggested actions through per-item handlers", async () => {
    const player = new DcPlayer(root, { artboards: liquidGlass });
    player.show("Brief.dc.html");
    const chip = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes("Mute until 11:15"))!;
    const before = chip.getAttribute("style");
    chip.click();
    await tick();
    expect(chip.getAttribute("style")).not.toBe(before);
  });
});
