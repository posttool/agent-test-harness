// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"handleDisabledFileLoadingAsSuccess":true}}
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SkinBindingPlan } from "@harness/core";
import { DcPlayer } from "@harness/dc-runtime";
import { bindSkin, demoView, rewriteArtboard, validateBound } from "../src/index.ts";

const LG = join(import.meta.dirname, "..", "..", "..", "skins", "liquid-glass");
const tick = () => new Promise((r) => setTimeout(r, 0));

// a1 root, a2 h1, a3 ul, a4 li, a5 b, a6 i, a7 li, a8 b, a9 i, a10 li, a11 b, a12 i, a13 button
const DESIGN = `<!doctype html><html lang="en"><head><title>Home</title></head><body><x-dc>
<div style="color: {{accent}}"><h1>Focused morning.</h1><ul>
<li style="padding: 4px"><b>Review</b><i>Maya · 9:12</i></li>
<li style="padding: 4px; border-top: 1px solid"><b>Lunch</b><i>Jon · 8:47</i></li>
<li style="padding: 4px; border-top: 1px solid"><b>Gym</b><i>Ana · 7:30</i></li>
</ul><button>Unlock</button></div></x-dc>
<script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#f80"}}'>class Component extends DCLogic { renderVals() { return { accent: this.props.accent }; } }</script></body></html>`;

const PLAN: SkinBindingPlan = {
  screen: "home",
  summary: "s",
  regions: [
    { anchor: "a2", label: "Headline", role: "live", slot: "brief", cardinality: "one", fields: [{ anchor: "a2", path: "headline", sample: "Focused morning." }], rationale: "r" },
    {
      anchor: "a3",
      label: "Waiting",
      role: "live",
      slot: "waiting",
      cardinality: "list",
      fields: [
        { anchor: "a5", path: "text", sample: "Review" },
        { anchor: "a6", path: "who", sample: "Maya" },
        { anchor: "a6", path: "when", sample: "9:12" },
      ],
      rationale: "r",
    },
  ],
  interactions: [
    { anchor: "a4", command: "act", argsFrom: "waiting[].id", rationale: "r" },
    { anchor: "a13", command: "unlock", argsFrom: "", rationale: "r" },
  ],
  needs: [],
  unmapped: [],
};

function play(source: string, extra: Record<string, unknown>) {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  const player = new DcPlayer(root, { artboards: { "Home.dc.html": source }, extraProps: extra });
  player.show("Home.dc.html");
  return root;
}

describe("rewriteArtboard", () => {
  it("turns copy into holes and rows into one loop, keeping the design's look and logic", async () => {
    const r = rewriteArtboard("Home.dc.html", DESIGN, PLAN, new DOMParser());
    expect(r.problems).toEqual(["Waiting: 1 part(s) differ between rows and are kept by position."]);
    expect(r.source).toContain('<sc-for list="{{bind.rows_a3}}" as="skinrow_a3" hint-placeholder-count="3">');
    expect(r.source).toContain("{{skinrow_a3.f1_a6}} · {{skinrow_a3.f2_a6}}");
    expect(r.source).toContain("class __Design extends DCLogic");
    expect(r.sample).toEqual({
      brief: { headline: "Focused morning." },
      waiting: [
        { id: "sample-a3-0", text: "Review", who: "Maya", when: "9:12" },
        { id: "sample-a3-1", text: "Lunch", who: "Jon", when: "8:47" },
        { id: "sample-a3-2", text: "Gym", who: "Ana", when: "7:30" },
      ],
    });
    const checks = await validateBound(r, DESIGN, PLAN);
    expect(checks.map((c) => [c.name, c.ok, c.notes])).toEqual([
      ["format", true, []],
      ["contract", true, []],
      ["fidelity", true, []],
      ["stress", true, []],
      ["commands", true, []],
    ]);
  });

  it("renders live data, keeps the first-row look by position, and sends skin commands", async () => {
    const r = rewriteArtboard("Home.dc.html", DESIGN, PLAN, new DOMParser());
    const sent: unknown[] = [];
    const view = demoView({ brief: { ...demoView().brief, headline: "A calm day" }, waiting: ["Sam", "Kim", "Lee", "Max"].map((who, i) => ({ id: `w${i}`, who, when: `${i}:00`, text: `Ask ${i}`, cta: "Reply" })) });
    const root = play(r.source, { skin: view, send: (c: unknown) => sent.push(c) });
    expect(root.querySelector("h1")!.textContent).toBe("A calm day");
    const rows = Array.from(root.querySelectorAll("li"));
    expect(rows.map((li) => li.textContent)).toEqual(["Ask 0Sam · 0:00", "Ask 1Kim · 1:00", "Ask 2Lee · 2:00", "Ask 3Max · 3:00"]);
    expect(rows.map((li) => li.getAttribute("style"))).toEqual(["padding: 4px", "padding: 4px; border-top: 1px solid", "padding: 4px; border-top: 1px solid", "padding: 4px; border-top: 1px solid"]);
    expect(root.querySelector("div")!.getAttribute("style")).toBe("color: #f80");
    rows[2]!.click();
    root.querySelector("button")!.click();
    await tick();
    expect(sent).toEqual([{ type: "act", itemId: "w2" }, { type: "unlock" }]);
  });
});

describe("bindSkin on Liquid Glass", () => {
  it("binds every analyzed artboard and passes the hard checks", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "skin-")), "liquid-glass");
    cpSync(LG, dir, { recursive: true });
    const r = await bindSkin(dir);
    expect(r.ok).toBe(true);
    const by = Object.fromEntries(r.artboards.map((a) => [a.file, a]));
    for (const file of ["Main.dc.html", "Home.dc.html", "Brief.dc.html"]) {
      expect(by[file]!.checks.filter((c) => !c.ok && c.name !== "contract")).toEqual([]);
    }
    expect(by["Brief.dc.html"]!.rewrite!.needs).toEqual(["weather"]);
    const bound = readFileSync(join(dir, "bound", "Main.dc.html"), "utf8");
    expect(bound).toContain("{{bind.b.");
    expect(readFileSync(join(dir, "bind-report.md"), "utf8")).toContain("Hard checks (format, fidelity, commands): **pass**.");
  });
});
