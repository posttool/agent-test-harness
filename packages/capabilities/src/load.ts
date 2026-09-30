import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilitySpec } from "@harness/core";
import { parseCapability } from "./parse.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
export const CAPABILITIES_DIR = join(here, "..", "capabilities");
export const PROMPTS_DIR = join(here, "..", "prompts");

/** The capabilities the loop starts with (PLAN.md section 4.3). */
export const DEFAULT_CAPABILITY_IDS = [
  "memory.read",
  "memory.write",
  "memory.organize",
  "tools.discover",
  "tools.use",
  "ui.generate",
] as const;

/** Loads every `*.md` capability in a directory (Node only). */
export async function loadCapabilities(dir = CAPABILITIES_DIR): Promise<CapabilitySpec[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  const specs = await Promise.all(
    names.map(async (name) => parseCapability(await readFile(join(dir, name), "utf8"), name)),
  );
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.id)) throw new Error(`Duplicate capability id "${spec.id}" in ${dir}`);
    seen.add(spec.id);
  }
  return specs;
}

/** Loads a named system prompt such as `loop` or `router` (Node only). */
export async function loadPrompt(name: string, dir = PROMPTS_DIR): Promise<string> {
  return (await readFile(join(dir, `${name}.md`), "utf8")).trim();
}
