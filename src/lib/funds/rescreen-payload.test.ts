/**
 * (beslutningslog 15. og 20. okt): the rescreen list sends no price. It used to read the
 * runs' prices with the service key and send the average and the cap to Medlem too, though the
 * panel uses neither. The call now reads with the member's own key, which cannot read a price
 * (0115), so it has none to send. This test fails if the key or a price comes back.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(resolve(import.meta.dirname, "rescreen.functions.ts"), "utf8");

test("the rescreen list reads no price and does not use the service key", () => {
  assert.doesNotMatch(source, /getServiceClient|admin\.server/);
  assert.doesNotMatch(source, /\b(actual_cost|estimated_cost|validation_result|token_usage)\b/);
  assert.doesNotMatch(source, /AI_BUDGETS|loadFundRunPlans|budget/);
});

test("the answer is the thesis, the active version and the candidates, nothing added to it", () => {
  assert.doesNotMatch(source, /Dkk|Usd|\.\.\./);
  const answer = source.slice(source.indexOf("export interface RescreenCandidates"));
  // The thesis the offer is for is the only addition (a comment line may precede it).
  assert.match(
    answer,
    /^export interface RescreenCandidates \{\n(?: {2}\/\*\*[^\n]*\*\/\n)? {2}thesisId: string;\n {2}activeVersion: number;\n {2}candidates: RescreenCandidate\[\];\n\}/,
  );
});
