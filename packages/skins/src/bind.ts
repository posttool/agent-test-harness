import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SkinManifestSchema } from "@harness/core";
import type { BindingFile } from "./analyze.ts";
import { missingScreensMarkdown } from "./briefs.ts";
import { withDom } from "./dom.ts";
import { rewriteArtboard, type RewriteResult } from "./rewrite.ts";
import { validateBound, type CheckResult } from "./validate.ts";

export interface BindResult {
  artboards: { file: string; rewrite: RewriteResult | null; checks: CheckResult[] }[];
  /** True when every hard check (format, fidelity, commands) passed. */
  ok: boolean;
}

const HARD: CheckResult["name"][] = ["format", "fidelity", "commands"];

/**
 * Binds every analyzed artboard of a skin (docs/SKINS_FROM_CLAUDE_DESIGN.md section 7): writes
 * bound/<file> from design/<file> and binding.json, runs the five checks, and writes
 * bind-report.md. design/ is never edited; bound/ is always regenerated, so fixes belong in
 * binding.json. Artboards without a plan are copied unchanged.
 */
export async function bindSkin(skinDir: string): Promise<BindResult> {
  const dir = resolve(skinDir);
  const design = join(dir, "design");
  const bindingFile = join(dir, "binding.json");
  if (!existsSync(bindingFile)) throw new Error(`${bindingFile} is missing: run npm run skin:analyze first.`);
  const binding = JSON.parse(readFileSync(bindingFile, "utf8")) as BindingFile;
  const manifest = SkinManifestSchema.parse(JSON.parse(readFileSync(join(dir, "skin.json"), "utf8")));
  const out = join(dir, "bound");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = readdirSync(design).filter((f) => f.endsWith(".dc.html"));
  if (existsSync(join(design, "assets"))) for (const a of readdirSync(join(design, "assets"))) {
    mkdirSync(join(out, "assets"), { recursive: true });
    writeFileSync(join(out, "assets", a), readFileSync(join(design, "assets", a)));
  }
  const result: BindResult = { artboards: [], ok: true };
  await withDom(async () => {
    for (const file of files) {
      const source = readFileSync(join(design, file), "utf8");
      const plan = binding.artboards[file]?.plan;
      if (!plan) {
        writeFileSync(join(out, file), source);
        result.artboards.push({ file, rewrite: null, checks: [] });
        continue;
      }
      const rewrite = rewriteArtboard(file, source, plan, new DOMParser());
      const checks = await validateBound(rewrite, source, plan);
      writeFileSync(join(out, file), rewrite.source);
      if (checks.some((c) => HARD.includes(c.name) && !c.ok)) result.ok = false;
      result.artboards.push({ file, rewrite, checks });
    }
  });
  writeFileSync(join(dir, "bind-report.md"), bindReport(manifest.name, result));
  writeFileSync(join(dir, "missing-screens.md"), missingScreensMarkdown(manifest));
  return result;
}

export function bindReport(name: string, r: BindResult): string {
  const lines = [`# ${name}: bind report`, "", `Hard checks (format, fidelity, commands): **${r.ok ? "pass" : "fail"}**.`, ""];
  for (const a of r.artboards) {
    lines.push(`## ${a.file}`, "");
    if (!a.rewrite) {
      lines.push("No binding plan: copied unchanged.", "");
      continue;
    }
    lines.push(`${a.rewrite.bound.length} values bound, ${a.rewrite.handlers.length} taps wired${a.rewrite.needs.length ? `, asks for ${a.rewrite.needs.join(", ")}` : ""}.`, "");
    lines.push("| Check | Result | Notes |", "|---|---|---|");
    for (const c of a.checks) lines.push(`| ${c.name} | ${c.ok ? "pass" : "fail"} | ${c.notes.join("; ").split("|").join("\\|").slice(0, 400)} |`);
    if (a.rewrite.problems.length) lines.push("", "Rewrite notes:", ...a.rewrite.problems.map((p) => `- ${p}`));
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
