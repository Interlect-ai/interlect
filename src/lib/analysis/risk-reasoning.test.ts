/** The deep analysis' risk check accepts a rationale in Danish and in English. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reasonsLikelihoodAndImpact } from "./risk-reasoning.ts";

test("Danish rationale: unchanged rule (sandsynlighed og konsekvens)", () => {
  assert.deepEqual(
    reasonsLikelihoodAndImpact("Sandsynligheden er moderat. Konsekvensen er høj for fonden."),
    { likelihood: true, impact: true },
  );
  assert.deepEqual(reasonsLikelihoodAndImpact("Risikoen er høj."), {
    likelihood: false,
    impact: false,
  });
});

test("English rationale is accepted (an English fund writes it in English)", () => {
  assert.deepEqual(
    reasonsLikelihoodAndImpact(
      "The likelihood is moderate because the stage is later. The impact on the fund is high.",
    ),
    { likelihood: true, impact: true },
  );
  assert.deepEqual(reasonsLikelihoodAndImpact("Probability 4 of 5; the consequence is severe."), {
    likelihood: true,
    impact: true,
  });
  assert.deepEqual(reasonsLikelihoodAndImpact("The team is strong."), {
    likelihood: false,
    impact: false,
  });
});
