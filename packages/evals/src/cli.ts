/**
 * Live scenario evals on both providers (PLAN.md section 10.5, M8). Costs money.
 *
 *   node packages/evals/src/cli.ts [scenarioId ...] [--providers claude,gemini]
 *
 * Writes evals/results/<timestamp>.json and .md.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeClient, DEFAULT_MODEL_POLICY, GeminiClient, ModelPolicySchema, type ModelPolicy, type ProviderClient, type ProviderId } from "@harness/core";
import { createNodeRuntime } from "@harness/runtime/node";
import { markdownReport, runScenario, ScenarioSchema, type EvalTarget, type ScenarioResult } from "./index.ts";

const root = process.cwd();
const args = process.argv.slice(2);
const providersArg = args.find((a) => a.startsWith("--providers="))?.split("=")[1] ?? "claude,gemini";
const only = args.filter((a) => !a.startsWith("--"));
const clients: Partial<Record<ProviderId, ProviderClient>> = {};
if (process.env.ANTHROPIC_API_KEY) clients.claude = new ClaudeClient();
if (process.env.GEMINI_API_KEY) clients.gemini = new GeminiClient();

const policyFor = (primary: ModelPolicy["primary"], fallbacks: ModelPolicy["fallbacks"]) => ModelPolicySchema.parse({ ...DEFAULT_MODEL_POLICY, primary, fallbacks, roles: {} });
const targets: EvalTarget[] = [
  { name: "claude", policy: policyFor({ provider: "claude", model: "claude-opus-5-5", serverFallback: true }, [{ provider: "claude", model: "claude-opus-5", serverFallback: true }]) },
  { name: "gemini", policy: policyFor({ provider: "gemini", model: "gemini-3.8-flash", serverFallback: false }, [{ provider: "gemini", model: "gemini-3.7-flash", serverFallback: false }]) },
].filter((t) => providersArg.split(",").includes(t.name));

const scenarios = readdirSync(join(root, "samples", "scenarios"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => ScenarioSchema.parse(JSON.parse(readFileSync(join(root, "samples", "scenarios", f), "utf8"))))
  .filter((s) => !only.length || only.includes(s.id));

// Judge and user simulator: Claude Opus 5.5 for every run, so both providers are graded alike.
const judge = { clients: { claude: clients.claude! }, policy: policyFor({ provider: "claude", model: "claude-opus-5-5", serverFallback: true }, []) };
if (!clients.claude) throw new Error("The judge needs ANTHROPIC_API_KEY");

const results: ScenarioResult[] = [];
for (const scenario of scenarios) {
  const runs = targets.map((target) =>
    runScenario(scenario, target, {
      judge,
      makeRuntime: async (policy) => {
        const rt = await createNodeRuntime({ root, clients, overrides: { autoRefreshSurfaces: false } });
        await rt.updateSettings({ policy });
        return rt;
      },
    }).then((r) => {
      console.log(`${scenario.id} · ${target.name}: ${r.verdict ? (r.verdict.pass ? "PASS" : "FAIL") : "ERROR"} ${r.verdict?.score ?? ""} ${r.error ?? ""}`);
      return r;
    }),
  );
  results.push(...(await Promise.all(runs)));
}
const when = new Date().toISOString().replaceAll(":", "-").slice(0, 19);
mkdirSync(join(root, "evals", "results"), { recursive: true });
writeFileSync(join(root, "evals", "results", `${when}.json`), JSON.stringify(results, null, 2));
writeFileSync(join(root, "evals", "results", `${when}.md`), markdownReport(results, when));
console.log(markdownReport(results, when).split("## Details")[0]);
