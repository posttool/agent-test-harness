import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listSkins, loadSkin } from "../server/skins.ts";

const ROOT_SKINS = join(import.meta.dirname, "..", "..", "..", "skins");

describe("skin packages", () => {
  it("lists the repo's skins, default first", () => {
    expect(listSkins(ROOT_SKINS).map((s) => [s.id, s.renderer])).toEqual([
      ["default", "builtin"],
      ["liquid-glass", "dc"],
    ]);
  });

  it("serves a skin's artboards with installed assets inlined, and nothing for unknown ids", () => {
    const skins = mkdtempSync(join(tmpdir(), "skins-"));
    const design = join(skins, "demo", "design");
    mkdirSync(join(design, "assets"), { recursive: true });
    writeFileSync(join(skins, "demo", "skin.json"), JSON.stringify({ id: "demo", name: "Demo", contract: 1, renderer: "dc" }));
    writeFileSync(join(design, "A.dc.html"), '<x-dc><img src="assets/p.png"></x-dc>');
    writeFileSync(join(design, "assets", "p.png"), "hi");
    writeFileSync(join(design, "notes.txt"), "not served");
    const pkg = loadSkin(skins, "demo")!;
    expect(pkg.from).toBe("design");
    expect(Object.keys(pkg.artboards)).toEqual(["A.dc.html"]);
    expect(pkg.artboards["A.dc.html"]).toContain('src="data:image/png;base64,aGk="');
    expect(loadSkin(skins, "../demo")).toBeNull();
    expect(loadSkin(skins, "nope")).toBeNull();
  });
});
