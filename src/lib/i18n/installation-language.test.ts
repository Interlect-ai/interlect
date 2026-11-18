/** The installation's language for log ind and the invitation. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cachedInstallationLanguage } from "./installation-language.ts";
import { languageToApply } from "./language.ts";

test("the installation's language is read once per few minutes", async () => {
  let clock = 0;
  let reads = 0;
  const language = cachedInstallationLanguage(
    async () => {
      reads += 1;
      return "en";
    },
    () => clock,
  );
  assert.equal(await language(), "en");
  clock = 4 * 60_000;
  assert.equal(await language(), "en");
  assert.equal(reads, 1);
  clock = 6 * 60_000;
  assert.equal(await language(), "en");
  assert.equal(reads, 2);
});

test("a failed read shows Danish, as before, and is tried again soon", async (t) => {
  t.mock.method(console, "error", () => {});
  let clock = 0;
  let fail = true;
  const language = cachedInstallationLanguage(
    async () => {
      if (fail) throw new Error("database down");
      return "en";
    },
    () => clock,
  );
  assert.equal(await language(), "da");
  fail = false;
  clock = 10_000;
  assert.equal(await language(), "da");
  clock = 31_000;
  assert.equal(await language(), "en");
});

test("T-890: a new team gets the language the guide was shown in", () => {
  assert.equal(languageToApply("da", "en"), "en");
  assert.equal(languageToApply("en", "da"), "da");
  assert.equal(languageToApply("en", "en"), null);
  assert.equal(languageToApply("da", undefined), null);
});
