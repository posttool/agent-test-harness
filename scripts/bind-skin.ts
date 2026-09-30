import { bindSkin } from "@harness/skins";

// npm run skin:bind -- skins/<id>
// Writes skins/<id>/bound/ from design/ and binding.json, runs the five checks, writes bind-report.md.
const dir = process.argv[2];
if (!dir) {
  console.error("Usage: npm run skin:bind -- skins/<id>");
  process.exit(1);
}
const r = await bindSkin(dir);
for (const a of r.artboards) {
  if (!a.rewrite) {
    console.log(`${a.file}: no plan, copied`);
    continue;
  }
  console.log(`${a.file}: ${a.rewrite.bound.length} bound, ${a.rewrite.handlers.length} taps · ${a.checks.map((c) => `${c.name} ${c.ok ? "✓" : "✗"}`).join(" · ")}`);
  for (const c of a.checks) for (const n of c.ok ? [] : c.notes) console.log(`   ${c.name}: ${n}`);
}
console.log(`Report: ${dir}/bind-report.md`);
process.exit(r.ok ? 0 : 2);
