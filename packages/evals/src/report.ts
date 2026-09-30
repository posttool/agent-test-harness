import type { ScenarioResult } from "./types/ScenarioResult.ts";

/** Side-by-side results per scenario and provider (PLAN.md M8). */
export function markdownReport(results: ScenarioResult[], when: string): string {
  const providers = [...new Set(results.map((r) => r.provider))];
  const lines = [`# Eval report · ${when}`, "", "| Scenario | " + providers.map((p) => `${p}: pass · score · calls · steps · s · $`).join(" | ") + " |", "|---|" + providers.map(() => "---").join("|") + "|"];
  for (const id of [...new Set(results.map((r) => r.scenarioId))]) {
    const cells = providers.map((p) => {
      const r = results.find((x) => x.scenarioId === id && x.provider === p);
      if (!r) return "–";
      const pass = r.verdict ? (r.verdict.pass ? "✅" : "❌") : "⚠️";
      return `${pass} · ${r.verdict ? r.verdict.score.toFixed(2) : "–"} · ${r.modelCalls} · ${r.steps} · ${(r.wallMs / 1000).toFixed(0)} · ${r.costUsd === null ? "n/a" : r.costUsd.toFixed(2)}`;
    });
    lines.push(`| ${id} | ${cells.join(" | ")} |`);
  }
  lines.push("", "## Totals", "");
  for (const p of providers) {
    const rs = results.filter((r) => r.provider === p);
    const passed = rs.filter((r) => r.verdict?.pass).length;
    const cost = rs.every((r) => r.costUsd !== null) ? `$${rs.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(2)}` : "n/a (no Gemini pricing)";
    lines.push(`- **${p}**: ${passed}/${rs.length} passed, mean score ${(rs.reduce((s, r) => s + (r.verdict?.score ?? 0), 0) / Math.max(rs.length, 1)).toFixed(2)}, ${rs.reduce((s, r) => s + r.modelCalls, 0)} model calls, cost ${cost}`);
  }
  lines.push("", "## Details", "");
  for (const r of results) {
    lines.push(`### ${r.scenarioId} · ${r.provider}`, "");
    if (r.error) lines.push(`Error: ${r.error}`, "");
    for (const reason of r.verdict?.reasons ?? []) lines.push(`- ${reason}`);
    lines.push("");
  }
  return lines.join("\n");
}
