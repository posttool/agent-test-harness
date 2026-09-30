import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatReport, installSkin } from "../src/index.ts";

const LIQUID_GLASS = join(import.meta.dirname, "..", "..", "..", "skins", "liquid-glass", "design");
const board = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><title>${title}</title></head><body><x-dc>${body}</x-dc><script type="text/x-dc" data-dc-script data-props='{"accent":{"editor":"color","default":"#f00"}}'>class Component extends DCLogic { renderVals() { return {}; } }</script></body></html>`;

function skinDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "skin-")), "my-skin");
  mkdirSync(join(dir, "design", "assets"), { recursive: true });
  return dir;
}

describe("installSkin", () => {
  it("installs the Liquid Glass canvas: parses every artboard and describes it", () => {
    const dir = skinDir();
    cpSync(LIQUID_GLASS, join(dir, "design"), { recursive: true });
    const r = installSkin(dir, { source: "https://claude.ai/artifact/x" });
    expect(r.problems).toEqual([]);
    expect(r.name).toBe("Liquid Glass Phone");
    expect(r.artboards.map((a) => [a.file, a.title, a.interactive])).toEqual([
      ["Main.dc.html", "Lock Screen", true],
      ["Home.dc.html", "Home Screen", true],
      ["Brief.dc.html", "Brief Detail", true],
    ]);
    expect(r.artboards[0]).toMatchObject({ conditions: 2, handlers: 1, links: ["Brief.dc.html", "Home.dc.html"], tweaks: ["font", "wallpaper", "orb1", "orb2", "orb3", "ground", "accent", "glass"] });
    expect(r.artboards[2]).toMatchObject({ loops: 1 });
    const manifest = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
    expect(manifest).toMatchObject({ id: "my-skin", renderer: "dc", source: "https://claude.ai/artifact/x", status: "incomplete", screens: {} });
    expect(Object.keys(manifest.installed.files)).toEqual(["Main.dc.html", "Home.dc.html", "Brief.dc.html", "canvas.json"]);
    expect(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name).toBe("@harness/skin-my-skin");
    expect(formatReport(r)).toContain('Installed "Liquid Glass Phone" as skins/my-skin (3 artboards).');
  });

  it("localizes /_blob/ assets, flags missing ones and broken links, and reports changes on re-install", () => {
    const dir = skinDir();
    writeFileSync(join(dir, "design", "assets", "abc123.png"), "png-bytes");
    writeFileSync(join(dir, "design", "canvas.json"), JSON.stringify({ title: "Test", order: ["A.dc.html", "B.dc.html"], boards: { "A.dc.html": { is_interactive: true } } }));
    writeFileSync(join(dir, "design", "A.dc.html"), board("A", `<img src="/_blob/abc123"><img src="/_blob/missing9"><a href="B.dc.html">b</a><a href="Gone.dc.html">x</a>`));
    writeFileSync(join(dir, "design", "B.dc.html"), board("B", "<p>{{accent}}</p>"));
    const first = installSkin(dir);
    expect(first.localized).toEqual(["/_blob/abc123 → assets/abc123.png"]);
    expect(readFileSync(join(dir, "design", "A.dc.html"), "utf8")).toContain('src="assets/abc123.png"');
    expect(first.problems).toEqual(["A.dc.html uses /_blob/missing9, which was not downloaded to design/assets/.", "A.dc.html links to Gone.dc.html, which is not in the canvas."]);

    // A hand-made screen mapping survives; a changed artboard is reported.
    const manifest = JSON.parse(readFileSync(join(dir, "skin.json"), "utf8"));
    writeFileSync(join(dir, "skin.json"), JSON.stringify({ ...manifest, screens: { lock: "A.dc.html", home: "Gone.dc.html" } }));
    writeFileSync(join(dir, "design", "B.dc.html"), board("B", "<p>changed</p>"));
    writeFileSync(join(dir, "design", "C.dc.html"), board("C", "<p>new</p>"));
    const second = installSkin(dir);
    expect(second.changes).toEqual({ added: ["C.dc.html"], changed: ["B.dc.html"], removed: [] });
    expect(second.manifest.screens).toEqual({ lock: "A.dc.html" });
    expect(second.artboards.map((a) => a.file)).toEqual(["A.dc.html", "B.dc.html", "C.dc.html"]);
  });

  it("refuses a folder with no design", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "skin-")), "empty");
    expect(() => installSkin(dir)).toThrow("does not exist");
  });
});
