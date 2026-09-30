import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SkinManifestSchema, type SkinManifest } from "@harness/core";

export interface SkinPackage {
  manifest: SkinManifest;
  /** The Claude Design canvas index (canvas.json), when there is one. */
  canvas: unknown;
  /** Artboard sources by file name: bound/ when the skin has been bound, else the original design/. */
  artboards: Record<string, string>;
  /** Which folder the artboards came from. */
  from: "bound" | "design" | null;
}

/** Every skin under skins/ with a valid skin.json. */
export function listSkins(skinsDir: string): SkinManifest[] {
  if (!existsSync(skinsDir)) return [];
  return readdirSync(skinsDir)
    .flatMap((dir) => {
      const file = join(skinsDir, dir, "skin.json");
      if (!existsSync(file)) return [];
      const parsed = SkinManifestSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success && parsed.data.id === dir ? [parsed.data] : [];
    })
    .sort((a, b) => (a.id === "default" ? -1 : b.id === "default" ? 1 : a.name.localeCompare(b.name)));
}

/** One skin's files, for the skin host page. Only listed skins, and only their .dc.html files and canvas.json. */
export function loadSkin(skinsDir: string, id: string): SkinPackage | null {
  const manifest = listSkins(skinsDir).find((s) => s.id === id);
  if (!manifest) return null;
  const pick = (["bound", "design"] as const).find((d) => existsSync(join(skinsDir, id, d)) && statSync(join(skinsDir, id, d)).isDirectory()) ?? null;
  const dir = pick ? join(skinsDir, id, pick) : null;
  const artboards = dir ? Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".dc.html")).map((f) => [f, readFileSync(join(dir, f), "utf8")])) : {};
  const canvasFile = join(skinsDir, id, "design", "canvas.json");
  const canvas: unknown = existsSync(canvasFile) ? JSON.parse(readFileSync(canvasFile, "utf8")) : null;
  return { manifest, canvas, artboards, from: pick };
}
