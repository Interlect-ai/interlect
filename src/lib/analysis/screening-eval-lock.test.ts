/**
 * (TS-20): the eval set runs at every code change of the screening prompt. When this test
 * fails, the screening prompt's code has changed since the last eval: run
 *   staging-live.yml  script=scripts/screening-eval.ts  args=--yes  allow_paid=true  max_usd=2
 * and copy the run's "record" line into src/lib/analysis/screening-eval-record.json. Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screeningPromptFingerprint, type ScreeningEvalRecord } from "./screening-eval-lock.ts";

const record = JSON.parse(
  readFileSync(new URL("./screening-eval-record.json", import.meta.url), "utf8"),
) as ScreeningEvalRecord;

test("evalueringssættet er kørt på den screeningsprompt, koden bygger nu", () => {
  assert.equal(
    record.promptFingerprint,
    screeningPromptFingerprint(),
    "Screeningsprompten er ændret siden sidste eval: kør scripts/screening-eval.ts via staging-live.yml (se toppen af denne fil) og opdatér screening-eval-record.json.",
  );
  assert.equal(record.result, "pass", "Den sidste eval bestod ikke.");
  assert.ok(record.calls >= 8 && record.calls <= 12, "Evalueringssættet har 8-12 kald.");
  assert.match(record.runId, /^\d+$/, "runId er staging-live-kørslens id.");
});
