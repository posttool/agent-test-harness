import { formatReport, installSkin } from "@harness/skins";

// npm run skin:install -- skins/<id> [--source <claude.ai canvas URL>] [--name "<name>"]
// Run after the canvas files are in skins/<id>/design/ (the install-skin skill puts them there).
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
};
const dir = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!dir) {
  console.error("Usage: npm run skin:install -- skins/<id> [--source <url>] [--name <name>]");
  process.exit(1);
}
const report = installSkin(dir, { source: flag("--source"), name: flag("--name") });
console.log(formatReport(report));
process.exit(report.problems.length ? 2 : 0);
