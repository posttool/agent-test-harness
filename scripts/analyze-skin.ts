import { ClaudeClient, DEFAULT_MODEL_POLICY, GeminiClient, ModelPolicyRunner, type ProviderClient, type ProviderId } from "@harness/core";
import { analyzeSkin } from "@harness/skins";

// npm run skin:analyze -- skins/<id> [--force] [--only Main.dc.html,Home.dc.html]
// One model call per artboard (the `designer` role). Uses ANTHROPIC_API_KEY / GEMINI_API_KEY.
const args = process.argv.slice(2);
const dir = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--only");
if (!dir) {
  console.error("Usage: npm run skin:analyze -- skins/<id> [--force] [--only A.dc.html,B.dc.html]");
  process.exit(1);
}
const clients: Partial<Record<ProviderId, ProviderClient>> = {};
if (process.env.ANTHROPIC_API_KEY) clients.claude = new ClaudeClient({ apiKey: process.env.ANTHROPIC_API_KEY });
if (process.env.GEMINI_API_KEY) clients.gemini = new GeminiClient({ apiKey: process.env.GEMINI_API_KEY });
if (!Object.keys(clients).length) {
  console.error("Set ANTHROPIC_API_KEY or GEMINI_API_KEY.");
  process.exit(1);
}
const runner = new ModelPolicyRunner({
  clients,
  policy: DEFAULT_MODEL_POLICY,
  onAttempt: (a) => console.log(`  ${a.model} attempt ${a.attempt}: ${a.outcome}${a.errorKind ? ` (${a.errorKind})` : ""}, ${Math.round(a.latencyMs / 1000)}s`),
});
const only = args.includes("--only") ? args[args.indexOf("--only") + 1]?.split(",") : undefined;
const r = await analyzeSkin(dir, runner, { force: args.includes("--force"), ...(only ? { only } : {}) });
console.log(`Analyzed ${r.analyzed.join(", ") || "nothing"}${r.kept.length ? `; kept ${r.kept.join(", ")} (unchanged)` : ""}. Cost about $${r.costUsd.toFixed(2)}.`);
console.log(`Screens: ${Object.entries(r.manifest.screens).map(([s, f]) => `${s} → ${f}`).join(", ")}. Missing: ${r.manifest.missingScreens.join(", ") || "none"}.`);
const problems = Object.entries(r.binding.artboards).flatMap(([f, b]) => b.problems.map((p) => `${f}: ${p}`));
if (problems.length) console.log(`Problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
console.log(`Report: ${dir}/binding-report.md`);
