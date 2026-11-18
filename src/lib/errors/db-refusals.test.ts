/** The database's refusals that say "fond" read in the dictionary's words. Kør: npm test */
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fundConfigErrorText } from "../funds/db-errors.ts";
import { DB_REFUSALS, dbRefusalText } from "./db-refusals.ts";
import { userMessage } from "./user-message.ts";

const MIGRATIONS = new URL("../../../db/migrations/", import.meta.url);

/** Every message a migration raises that names "fond". */
function fondRefusals(): string[] {
  const found = new Set<string>();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    for (const match of sql.matchAll(/raise exception\s+'((?:[^']|'')*)'/gi)) {
      const message = match[1]!.replace(/''/g, "'");
      if (/fond/i.test(message)) found.add(message);
    }
  }
  return [...found];
}

test("every refusal a migration raises with 'fond' has the dictionary's words", () => {
  const known = new Set(DB_REFUSALS.map(([message]) => message));
  const missing = fondRefusals().filter((message) => !known.has(message));
  assert.deepEqual(missing, [], "add the message to DB_REFUSALS in src/lib/errors/db-refusals.ts");
});

test("the words say team or setup, never fond or fund, in both languages", () => {
  for (const [message] of DB_REFUSALS) {
    const shown = message.replace("%", "fund_config_versions");
    const da = dbRefusalText(shown, "da");
    const en = dbRefusalText(shown, "en");
    assert.ok(da && en, message);
    assert.doesNotMatch(da, /fond/i, message);
    assert.doesNotMatch(en, /fond|fund/i, message);
  }
  assert.equal(dbRefusalText("Noget helt andet.", "da"), null);
  assert.equal(dbRefusalText(null, "en"), null);
});

test("the person reads them in the page's language", () => {
  assert.equal(
    userMessage(new Error("Fonden blev ikke fundet."), "fallback", "en"),
    "The team was not found.",
  );
  assert.equal(
    userMessage(new Error("Fondsprofilen mangler mandat."), "fallback", "da"),
    "Opsætningen mangler mandat.",
  );
  assert.equal(
    fundConfigErrorText(
      { code: "P0001", message: "En ticket kan ikke være større end fonden." },
      "fallback",
      { language: "en" },
    ),
    "A ticket cannot be larger than the investable capital.",
  );
  // Our other refusals are still shown as written.
  assert.equal(
    fundConfigErrorText({ code: "P0001", message: "Vægtene skal summe til 100." }, "fallback"),
    "Vægtene skal summe til 100.",
  );
});
