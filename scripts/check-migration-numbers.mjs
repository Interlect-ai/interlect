// Fails when two forward migrations share a number, or a migration is not named NNNN_name.sql.
// run-migrations.mjs sorts on the whole file name, so a shared number still runs in a fixed
// order, but which one goes first is decided by the name, not by intent. The four pairs
// below were merged before this check and have already run everywhere, so they stay.
import { readdirSync } from "node:fs";

const ALLOWED_PAIRS = new Set(["0076", "0078", "0088", "0091"]);

const dir = new URL("../db/migrations/", import.meta.url);
const files = readdirSync(dir).filter(
  (name) => name.endsWith(".sql") && !name.endsWith(".down.sql"),
);
const problems = [];
const byNumber = new Map();

for (const name of files) {
  const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(name);
  if (!match) {
    problems.push(`${name} is not named NNNN_name.sql (four digits, lowercase, underscores)`);
    continue;
  }
  byNumber.set(match[1], [...(byNumber.get(match[1]) ?? []), name]);
}

for (const [number, names] of byNumber) {
  if (names.length > 1 && !(ALLOWED_PAIRS.has(number) && names.length === 2)) {
    problems.push(`number ${number} is used by ${names.join(", ")}: give the new one the next free number`);
  }
}

if (problems.length) {
  console.error("Migration number check failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
const highest = [...byNumber.keys()].sort().at(-1);
console.log(`Migration numbers OK: ${files.length} migrations, highest ${highest}.`);
