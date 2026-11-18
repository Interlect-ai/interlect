// Fails when a chart dependency drifts onto a prerelease. The bklit registry currently asks
// for @visx 4.0.1-alpha; our vendored charts are built and verified against stable 4.0.0.
// Also fails if Recharts comes back: every chart in the product uses bklit/visx.
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };
const problems = [];

for (const [name, range] of Object.entries(declared)) {
  if (name.startsWith("@visx/") && /alpha|beta|rc|next/i.test(range)) {
    problems.push(`${name} is declared as prerelease "${range}" in package.json`);
  }
  if (name === "recharts") problems.push("recharts is back in package.json");
}

for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  const name = path.split("node_modules/").pop();
  if (name?.startsWith("@visx/") && /-(alpha|beta|rc|next)/i.test(entry.version ?? "")) {
    problems.push(`${name}@${entry.version} is installed (${path})`);
  }
}

if (problems.length) {
  console.error("Chart dependency check failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("Chart dependencies OK: @visx is stable and Recharts is absent.");
