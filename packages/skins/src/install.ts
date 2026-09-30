import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { Window } from "happy-dom";
import { SkinManifestSchema, type SkinManifest } from "@harness/core";
import { parseArtboard, type Artboard } from "@harness/dc-runtime";

/** What an install found and did (docs/SKINS_FROM_CLAUDE_DESIGN.md section 5). */
export interface InstallReport {
  skinId: string;
  name: string;
  artboards: { file: string; title: string; tweaks: string[]; loops: number; conditions: number; handlers: number; links: string[]; imports: string[]; interactive: boolean }[];
  /** Relative to the last install: files added, changed and removed. Empty lists on a first install. */
  changes: { added: string[]; changed: string[]; removed: string[] };
  /** Asset URLs rewritten to local files under design/assets. */
  localized: string[];
  problems: string[];
  manifest: SkinManifest;
}

interface CanvasIndex {
  title?: string;
  boards?: Record<string, { title?: string; is_interactive?: boolean }>;
  order?: string[];
}

const BLOB = "/_blob/";

function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function slugify(text: string): string {
  let out = "";
  for (const ch of text.toLowerCase()) out += (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") ? ch : "-";
  return out.split("-").filter(Boolean).join("-") || "skin";
}

/** Every `/_blob/<id>` reference in a source, as written. */
function blobRefs(source: string): string[] {
  const refs = new Set<string>();
  let at = source.indexOf(BLOB);
  while (at >= 0) {
    let end = at + BLOB.length;
    while (end < source.length && !`"')\` \n<>`.includes(source[end]!)) end++;
    refs.add(source.slice(at, end));
    at = source.indexOf(BLOB, end);
  }
  return [...refs];
}

/** The design's own count of a construct, for the report. */
function count(el: Element, selector: string): number {
  return el.querySelectorAll(selector).length;
}

function describe(artboard: Artboard, interactive: boolean): InstallReport["artboards"][number] {
  const t = artboard.template;
  let handlers = 0;
  for (const el of Array.from(t.querySelectorAll("*"))) for (const a of Array.from(el.attributes)) if (a.name.startsWith("on") && a.value.includes("{{")) handlers++;
  const links = Array.from(t.querySelectorAll("a[href]"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.endsWith(".dc.html"));
  return {
    file: artboard.file,
    title: artboard.title,
    tweaks: Object.entries(artboard.props)
      .filter(([, spec]) => spec?.editor)
      .map(([k]) => k),
    loops: count(t, "sc-for"),
    conditions: count(t, "sc-if"),
    handlers,
    links: [...new Set(links)],
    imports: Array.from(t.querySelectorAll("dc-import")).map((i) => i.getAttribute("name") ?? ""),
    interactive,
  };
}

/**
 * Installs (or re-installs) a Claude Design canvas that has been placed in `skins/<id>/design/`:
 * checks the canvas and every artboard parse, rewrites `/_blob/` asset URLs to files under
 * design/assets, records file hashes, and writes skin.json and package.json. Existing binding
 * choices in skin.json (screens, needs) are kept.
 */
export function installSkin(skinDir: string, options: { source?: string | null; name?: string | null } = {}): InstallReport {
  const dir = resolve(skinDir);
  const design = join(dir, "design");
  const problems: string[] = [];
  if (!existsSync(design)) throw new Error(`${design} does not exist. Put the canvas files (canvas.json and the .dc.html artboards) there first.`);
  const skinId = basename(dir);

  const canvasFile = join(design, "canvas.json");
  const canvas: CanvasIndex = existsSync(canvasFile) ? (JSON.parse(readFileSync(canvasFile, "utf8")) as CanvasIndex) : {};
  if (!existsSync(canvasFile)) problems.push("design/canvas.json is missing: artboard order and sizes fall back to defaults.");
  const onDisk = readdirSync(design).filter((f) => f.endsWith(".dc.html"));
  const order = [...(canvas.order ?? []).filter((f) => onDisk.includes(f)), ...onDisk.filter((f) => !(canvas.order ?? []).includes(f)).sort()];
  for (const f of canvas.order ?? []) if (!onDisk.includes(f)) problems.push(`canvas.json lists ${f}, which is not in design/.`);
  if (!order.length) throw new Error(`${design} has no .dc.html artboards.`);

  // Assets: /_blob/ URLs only resolve on claude.ai. The fetch step saves each one under design/assets/.
  const assetsDir = join(design, "assets");
  const assets = existsSync(assetsDir) ? readdirSync(assetsDir) : [];
  const localized: string[] = [];
  for (const file of order) {
    let source = readFileSync(join(design, file), "utf8");
    for (const ref of blobRefs(source)) {
      const id = ref.slice(BLOB.length).split("?")[0]!.split("/").at(-1)!;
      const local = assets.find((a) => a === id || a.slice(0, a.length - extname(a).length) === id);
      if (!local) {
        problems.push(`${file} uses ${ref}, which was not downloaded to design/assets/.`);
        continue;
      }
      source = source.split(ref).join(`assets/${local}`);
      localized.push(`${ref} → assets/${local}`);
    }
    writeFileSync(join(design, file), source);
  }

  const { DOMParser: HappyParser } = new Window();
  const parser = new HappyParser() as unknown as DOMParser;
  const artboards: InstallReport["artboards"] = [];
  for (const file of order) {
    try {
      const parsed = parseArtboard(file, readFileSync(join(design, file), "utf8"), parser);
      const info = describe(parsed, canvas.boards?.[file]?.is_interactive ?? false);
      for (const link of info.links) if (!order.includes(link.startsWith("./") ? link.slice(2) : link)) problems.push(`${file} links to ${link}, which is not in the canvas.`);
      for (const name of info.imports) if (!order.includes(`${name}.dc.html`)) problems.push(`${file} imports ${name}, which is not in the canvas.`);
      artboards.push(info);
    } catch (error) {
      problems.push(`${file} does not parse: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestFile = join(dir, "skin.json");
  const previous = existsSync(manifestFile) ? SkinManifestSchema.safeParse(JSON.parse(readFileSync(manifestFile, "utf8"))) : null;
  const prior = previous?.success ? previous.data : null;
  const files: Record<string, string> = {};
  for (const f of [...order, ...(existsSync(canvasFile) ? ["canvas.json"] : []), ...assets.map((a) => `assets/${a}`)]) files[f] = sha256(readFileSync(join(design, f)));
  const before = prior?.installed?.files ?? {};
  const changes = prior?.installed
    ? {
        added: Object.keys(files).filter((f) => !(f in before)),
        changed: Object.keys(files).filter((f) => f in before && before[f] !== files[f]),
        removed: Object.keys(before).filter((f) => !(f in files)),
      }
    : { added: [], changed: [], removed: [] };

  const manifest = SkinManifestSchema.parse({
    ...(prior ?? {}),
    id: skinId,
    name: options.name ?? prior?.name ?? canvas.title ?? skinId,
    contract: 1,
    renderer: "dc",
    source: options.source ?? prior?.source ?? null,
    // Screens are mapped by the analysis step (S4) or by hand; keep them, but drop artboards that are gone.
    screens: Object.fromEntries(Object.entries(prior?.screens ?? {}).filter(([, f]) => order.includes(f))),
    status: prior?.status ?? "incomplete",
    installed: { at: new Date().toISOString(), files },
  });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const pkgFile = join(dir, "package.json");
  if (!existsSync(pkgFile)) {
    writeFileSync(pkgFile, `${JSON.stringify({ name: `@harness/skin-${slugify(skinId)}`, version: "0.0.0", private: true, description: `Installed from the Claude Design canvas "${manifest.name}". design/ holds the canvas files.` }, null, 2)}\n`);
  }
  mkdirSync(design, { recursive: true });
  return { skinId, name: manifest.name, artboards, changes, localized, problems, manifest };
}

/** A short text report for the terminal and the Skin panel. */
export function formatReport(r: InstallReport): string {
  const lines = [`Installed "${r.name}" as skins/${r.skinId} (${r.artboards.length} artboards).`];
  for (const a of r.artboards) {
    lines.push(`- ${a.file} "${a.title}"${a.interactive ? " (interactive)" : ""}: ${a.loops} loops, ${a.conditions} conditions, ${a.handlers} handlers${a.links.length ? `, links to ${a.links.join(", ")}` : ""}${a.tweaks.length ? `; tweaks: ${a.tweaks.join(", ")}` : ""}`);
  }
  const { added, changed, removed } = r.changes;
  if (added.length || changed.length || removed.length) lines.push(`Changes since the last install: ${[added.length ? `added ${added.join(", ")}` : "", changed.length ? `changed ${changed.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""].filter(Boolean).join("; ")}.`);
  for (const l of r.localized) lines.push(`Localized ${l}`);
  if (r.problems.length) lines.push("Problems:", ...r.problems.map((p) => `- ${p}`));
  const screens = Object.entries(r.manifest.screens);
  lines.push(screens.length ? `Screens: ${screens.map(([k, f]) => `${k} → ${f}`).join(", ")}.` : "No screens are mapped yet; the analysis step (S4) maps them, or set `screens` in skin.json by hand.");
  return lines.join("\n");
}
