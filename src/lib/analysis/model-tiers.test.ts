import assert from "node:assert/strict";
import { test } from "node:test";
import { AI_BUDGETS } from "./budgets.ts";
import {
  AI_TIERS,
  CAP_LIMITS_DKK,
  DEEP_CALL_TIMEOUT_MS,
  SCREENING_CALL_TIMEOUT_MS,
  TIER_MODELS,
  buildRunPlan,
  estimatedRunCostDkk,
  isValidCapDkk,
  legacyRunPlan,
  normalizeAiTier,
  planColumns,
  planFromStoredRun,
  resolveRunBudget,
  standardCapDkk,
} from "./model-tiers.ts";

test("an unknown or missing tier falls back to Middel", () => {
  assert.equal(normalizeAiTier(undefined), "medium");
  assert.equal(normalizeAiTier("ultra"), "medium");
  assert.equal(normalizeAiTier("heavy"), "heavy");
});

test("the light screening and the medium deep analysis keep the caps the product had", () => {
  assert.deepEqual(legacyRunPlan("screening").budget, {
    dkk: AI_BUDGETS.screening.dkk,
    usd: AI_BUDGETS.screening.usd,
    researchUsd: AI_BUDGETS.screening.researchUsd,
    analysisUsd: AI_BUDGETS.screening.analysisUsd,
    specialistsUsd: 0,
    synthesisUsd: 0,
  });
  const deep = legacyRunPlan("deep");
  assert.equal(deep.model, "openai/gpt-5.4");
  assert.equal(deep.budget.dkk, AI_BUDGETS.deep.dkk);
  assert.equal(deep.budget.usd, AI_BUDGETS.deep.usd);
  assert.equal(deep.budget.specialistsUsd, AI_BUDGETS.deep.specialistsUsd);
  assert.equal(deep.budget.synthesisUsd, AI_BUDGETS.deep.synthesisUsd);
});

test("every tier's standard parts add up to its cap and never pass the DKK cap", () => {
  for (const kind of ["screening", "deep"] as const) {
    for (const tier of AI_TIERS) {
      const { budget } = resolveRunBudget(kind, tier, null);
      const parts =
        kind === "screening"
          ? budget.researchUsd + budget.analysisUsd
          : budget.researchUsd + budget.specialistsUsd + budget.synthesisUsd;
      assert.ok(
        Math.abs(parts - budget.usd) < 0.0001,
        `${kind}/${tier}: ${parts} vs ${budget.usd}`,
      );
      assert.ok(budget.usd * AI_BUDGETS.exchangeRateDkkPerUsd <= budget.dkk + 1e-9);
      if (kind === "deep") {
        assert.ok(
          Math.abs(budget.specialistsUsd + budget.synthesisUsd - budget.analysisUsd) < 0.0001,
        );
      }
    }
  }
});

test("the default plan is Middel with a heavier model than Let", () => {
  const plan = buildRunPlan("screening", "medium", null);
  assert.equal(plan.model, TIER_MODELS.screening.medium);
  assert.notEqual(plan.model, TIER_MODELS.screening.light);
  assert.equal(plan.customCap, false);
});

test("a confirmed cap is the real limit and scales every part without passing it", () => {
  const { budget, customCap } = resolveRunBudget("screening", "heavy", 12);
  assert.equal(customCap, true);
  assert.equal(budget.dkk, 12);
  assert.ok(budget.usd * AI_BUDGETS.exchangeRateDkkPerUsd <= 12 + 1e-9);
  assert.ok(budget.researchUsd + budget.analysisUsd <= budget.usd + 1e-9);
  const deep = resolveRunBudget("deep", "light", 10).budget;
  assert.ok(deep.researchUsd + deep.specialistsUsd + deep.synthesisUsd <= deep.usd + 1e-9);
});

test("a cap equal to the standard is not a custom cap", () => {
  const standard = standardCapDkk("deep", "medium");
  assert.equal(resolveRunBudget("deep", "medium", standard).customCap, false);
});

test("a cap outside the hard limits is ignored instead of trusted", () => {
  for (const bad of [0, -5, Number.NaN, 100_000]) {
    assert.equal(isValidCapDkk("screening", bad), false);
    assert.equal(resolveRunBudget("screening", "medium", bad).customCap, false);
  }
  assert.equal(CAP_LIMITS_DKK.screening.max, 100);
});

test("the estimates rise with the level", () => {
  for (const kind of ["screening", "deep"] as const) {
    assert.ok(estimatedRunCostDkk(kind, "light") < estimatedRunCostDkk(kind, "medium"));
    assert.ok(estimatedRunCostDkk(kind, "medium") < estimatedRunCostDkk(kind, "heavy"));
    assert.ok(estimatedRunCostDkk(kind, "heavy") < standardCapDkk(kind, "heavy"));
  }
});

test("a stored run keeps the level and cap it started with; an old run gets the legacy plan", () => {
  const old = planFromStoredRun("screening", { ai_tier: null, cost_cap_dkk: null });
  assert.equal(old.legacy, true);
  assert.equal(old.model, "openai/gpt-5.4-mini");
  assert.deepEqual(planColumns(old), {});

  const heavy = planFromStoredRun("deep", { ai_tier: "heavy", cost_cap_dkk: "45.00" });
  assert.equal(heavy.tier, "heavy");
  assert.equal(heavy.customCap, true);
  assert.equal(heavy.budget.dkk, 45);
  assert.deepEqual(planColumns(heavy), { ai_tier: "heavy", cost_cap_dkk: 45 });

  // A stored cap outside the hard limits is never trusted.
  assert.equal(
    planFromStoredRun("screening", { ai_tier: "medium", cost_cap_dkk: 5000 }).customCap,
    false,
  );
});

test("the bigger models get more time but never more than a 300 s background function can give", () => {
  assert.equal(SCREENING_CALL_TIMEOUT_MS.light, 90_000);
  assert.ok(SCREENING_CALL_TIMEOUT_MS.light < SCREENING_CALL_TIMEOUT_MS.medium);
  assert.ok(SCREENING_CALL_TIMEOUT_MS.medium <= SCREENING_CALL_TIMEOUT_MS.heavy);
  for (const tier of AI_TIERS) {
    // About 30 s of research comes before the screening call in the same function.
    assert.ok(SCREENING_CALL_TIMEOUT_MS[tier] + 60_000 <= 300_000);
    assert.ok(DEEP_CALL_TIMEOUT_MS[tier].specialist < 300_000);
    assert.ok(DEEP_CALL_TIMEOUT_MS[tier].synthesis < 300_000);
  }
});
