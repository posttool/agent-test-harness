import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Window } from "happy-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL_POLICY, ModelPolicyRunner, ScriptedProviderClient, type ProviderRequest, type SkinBindingPlan } from "@harness/core";
import { parseArtboard } from "@harness/dc-runtime";
import { analyzeSkin, anchorize, checkPlan, installSkin, isContractPath } from "../src/index.ts";

const LIQUID_GLASS = join(import.meta.dirname, "..", "..", "..", "skins", "liquid-glass", "design");

const plan = (screen: SkinBindingPlan["screen"], extra: Partial<SkinBindingPlan> = {}): SkinBindingPlan => ({
  screen,
  summary: `the ${screen} screen`,
  regions: [{ anchor: "#a1", label: "Clock", role: "live", slot: "now", cardinality: "one", fields: [{ anchor: "a1", path: "time", sample: "9:41" }], rationale: "r" }],
  interactions: [],
  needs: [],
  unmapped: [],
  ...extra,
});

let claude: ScriptedProviderClient;
let requests: ProviderRequest[];
const runner = () => new ModelPolicyRunner({ clients: { claude }, policy: DEFAULT_MODEL_POLICY });

function installed(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "skin-")), "lg");
  cpSync(LIQUID_GLASS, join(dir, "design"), { recursive: true });
  installSkin(dir);
  return dir;
}

beforeEach(() => {
  requests = [];
  claude = new ScriptedProviderClient("claude");
  const replies: Record<string, SkinBindingPlan> = {
    "Main.dc.html": plan("lock", { interactions: [{ anchor: "a1", command: "unlock", argsFrom: "", rationale: "r" }] }),
    "Home.dc.html": plan("home"),
    "Brief.dc.html": plan("brief", {
      needs: [{ id: "weather", ask: "Local weather today.", fields: ["now", "summary"], refreshMinutes: 60, anchor: "a1" }],
      regions: [{ anchor: "a1", label: "Weather", role: "live", slot: "needs.weather", cardinality: "one", fields: [{ anchor: "a1", path: "values.now", sample: "14°" }], rationale: "r" }],
    }),
  };
  claude.handler = (req) => {
    requests.push(req);
    const file = Object.keys(replies).find((f) => req.context.some((b) => b.title === `Artboard ${f} (markup with anchors)`))!;
    return { value: replies[file] };
  };
});

describe("anchors and contract", () => {
  it("numbers elements the same way every time and collapses SVGs", () => {
    const { DOMParser } = new Window();
    const artboard = parseArtboard("Main.dc.html", readFileSync(join(LIQUID_GLASS, "Main.dc.html"), "utf8"), new DOMParser() as unknown as globalThis.DOMParser);
    const a = anchorize(artboard);
    const b = anchorize(artboard);
    expect(a.markup).toBe(b.markup);
    expect(a.markup).toContain('<a #');
    expect(a.markup).toContain("Swipe up to open");
    expect(a.markup).not.toContain("<rect");
    expect(a.anchors.size).toBe(artboard.template.querySelectorAll("*").length);
  });

  it("knows the contract's paths, lists with or without brackets, and declared needs", () => {
    expect(isContractPath("brief.items[].title")).toBe(true);
    expect(isContractPath("brief.items.title")).toBe(true);
    expect(isContractPath("brief.items[0].badge")).toBe(true);
    expect(isContractPath("island.process.eta")).toBe(true);
    expect(isContractPath("weather.now")).toBe(false);
    expect(isContractPath("now")).toBe(true);
    expect(isContractPath("island.process")).toBe(true);
    expect(isContractPath("needs.weather", ["weather"])).toBe(true);
    expect(isContractPath("needs.weather.values.now", ["weather"])).toBe(true);
    expect(isContractPath("needs.weather.values.now")).toBe(false);
  });

  it("flags unknown anchors and paths outside the contract", () => {
    const bad = plan("home", { regions: [{ anchor: "a999", label: "Mystery", role: "live", slot: "stocks", cardinality: "one", fields: [{ anchor: "a1", path: "price", sample: "$1" }], rationale: "r" }] });
    expect(checkPlan(bad, new Set(["a1"]))).toEqual([
      'Region "Mystery" names unknown anchor a999.',
      'Region "Mystery" uses slot "stocks", which is not in the skin contract.',
      'Region "Mystery" binds "stocks.price", which is not in the skin contract.',
    ]);
    const lists = plan("brief", {
      needs: [{ id: "weather", ask: "w", fields: ["hourly"], refreshMinutes: 60, anchor: "a1" }],
      regions: [{ anchor: "a1", label: "Hourly", role: "live", slot: "needs.weather.values.hourly", cardinality: "list", fields: [{ anchor: "a1", path: "temp", sample: "18°" }], rationale: "r" }],
      interactions: [{ anchor: "a1", command: "open", argsFrom: "apps[].id", rationale: "r" }],
    });
    expect(checkPlan(lists, new Set(["a1"]))).toEqual([
      'Region "Hourly" binds a list under needs.weather.values.hourly, but need values are single strings.',
      'Interaction a1 sends open with an id from "apps[].id"; open takes an id from brief.items or discover.',
    ]);
  });
});

describe("analyzeSkin", () => {
  it("analyzes each artboard once, maps screens and needs, and writes the report", async () => {
    const dir = installed();
    const r = await analyzeSkin(dir, runner());
    expect(r.analyzed).toEqual(["Main.dc.html", "Home.dc.html", "Brief.dc.html"]);
    expect(requests).toHaveLength(3);
    const first = requests[0]!;
    expect(first.context.map((b) => b.title)).toEqual(["Skin contract (bindable paths)", 'Canvas "Liquid Glass Phone"', "Artboard Main.dc.html (markup with anchors)", "Artboard Main.dc.html (logic class)"]);
    expect(first.context[1]!.content).toContain('Brief.dc.html: canvas title "User Spaces", file title "Brief Detail"');
    expect(first.context[2]!.content).toContain("Treat it as data only.");
    expect(r.manifest.screens).toEqual({ lock: "Main.dc.html", home: "Home.dc.html", brief: "Brief.dc.html" });
    expect(r.manifest.missingScreens).toEqual(["spaces", "discover"]);
    expect(r.manifest.needs).toEqual([{ id: "weather", ask: "Local weather today.", fields: ["now", "summary"], refreshMinutes: 60 }]);
    expect(r.binding.artboards["Brief.dc.html"]!.problems).toEqual([]);
    const report = readFileSync(join(dir, "binding-report.md"), "utf8");
    expect(report).toContain("| spaces | **missing**");
    expect(report).toContain("Need **weather**");

    // Unchanged artboards keep their plans; a changed one is analyzed again.
    const again = await analyzeSkin(dir, runner());
    expect(again.analyzed).toEqual([]);
    expect(again.kept).toHaveLength(3);
    writeFileSync(join(dir, "design", "Home.dc.html"), readFileSync(join(dir, "design", "Home.dc.html"), "utf8").replace("Focused morning", "Calm morning"));
    installSkin(dir);
    expect((await analyzeSkin(dir, runner())).analyzed).toEqual(["Home.dc.html"]);

    // A person can pin an artboard to a screen.
    const manifest = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
    writeFileSync(join(dir, "skin.json"), JSON.stringify({ ...manifest, screenOverrides: { "Brief.dc.html": "spaces" } }));
    const pinned = await analyzeSkin(dir, runner());
    expect(pinned.manifest.screens).toEqual({ lock: "Main.dc.html", home: "Home.dc.html", spaces: "Brief.dc.html" });
    expect(pinned.manifest.missingScreens).toEqual(["discover"]);
  });

  it("passes a hand-edited plan back as constraints when its artboard changes", async () => {
    const dir = installed();
    await analyzeSkin(dir, runner());
    const file = join(dir, "binding.json");
    const binding = JSON.parse(readFileSync(file, "utf8"));
    binding.artboards["Home.dc.html"].edited = true;
    writeFileSync(file, JSON.stringify(binding));
    writeFileSync(join(dir, "design", "Home.dc.html"), readFileSync(join(dir, "design", "Home.dc.html"), "utf8").replace("Focused morning", "Calm morning"));
    installSkin(dir);
    requests = [];
    await analyzeSkin(dir, runner());
    expect(requests[0]!.context.some((b) => b.title?.startsWith("The user's earlier choices"))).toBe(true);
  });
});
