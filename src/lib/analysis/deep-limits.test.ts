import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateRequestMaximumUsd } from "./budgets.ts";
import { expectedSeconds, outputTokenCap, synthesisReasoningEffort } from "./deep-limits.ts";
import {
  FUNCTION_MAX_DURATION_SECONDS,
  SAVE_MARGIN_MS,
  MAX_CALL_TIMEOUT_MS,
  SYNTHESIS_MAX_OUTPUT_TOKENS,
  SPECIALIST_MAX_OUTPUT_TOKENS,
} from "./deep-text-rules.ts";
import { AI_TIERS, buildRunPlan, DEEP_CALL_TIMEOUT_MS, TIER_MODELS } from "./model-tiers.ts";

test("the synthesis cap is the design cap on EVERY level; the timeout is the time guard (#3)", () => {
  for (const tier of AI_TIERS) {
    const model = TIER_MODELS.deep[tier];
    assert.equal(outputTokenCap("synthesis", tier, model), SYNTHESIS_MAX_OUTPUT_TOKENS);
    assert.equal(outputTokenCap("specialist", tier, model), SPECIALIST_MAX_OUTPUT_TOKENS);
    assert.ok(SYNTHESIS_MAX_OUTPUT_TOKENS >= 16_000);
  }
});

test("timeouts fit the function with room to set up and save; Middel's measured call fits (#8)", () => {
  for (const tier of AI_TIERS) {
    const limits = DEEP_CALL_TIMEOUT_MS[tier];
    assert.ok(limits.specialist <= MAX_CALL_TIMEOUT_MS, `${tier} specialist timeout`);
    assert.ok(limits.synthesis <= MAX_CALL_TIMEOUT_MS, `${tier} synthesis timeout`);
  }
  assert.ok(MAX_CALL_TIMEOUT_MS + SAVE_MARGIN_MS <= FUNCTION_MAX_DURATION_SECONDS * 1000);
  assert.ok(SAVE_MARGIN_MS >= 80_000, "set-up, saving, tasks and the Brain hand-over need room");
  // Measured (Pleo, Middel, v10c): 11.1k output tokens in 178 s. A 12.5k synthesis at that speed
  // must still end before the timeout, with margin.
  const measuredRate = 11_100 / 178;
  assert.ok(12_500 / measuredRate <= (DEEP_CALL_TIMEOUT_MS.medium.synthesis / 1000) * 0.95);
  assert.ok(
    expectedSeconds(12_500, TIER_MODELS.deep.medium) < DEEP_CALL_TIMEOUT_MS.medium.synthesis / 1000,
  );
});

test("an unknown model still gets the design cap", () => {
  assert.equal(
    outputTokenCap("synthesis", "medium", "some/new-model"),
    SYNTHESIS_MAX_OUTPUT_TOKENS,
  );
});

test("the standard loft of every tier covers the worst-case reservation of one call (60k input tokens)", () => {
  const body = { messages: [{ role: "user", content: "ord ".repeat(60_000) }] };
  for (const tier of AI_TIERS) {
    const plan = buildRunPlan("deep", tier, null);
    const specialist = estimateRequestMaximumUsd({
      model: plan.model,
      requestBody: body,
      maxOutputTokens: outputTokenCap("specialist", tier, plan.model),
    });
    const synthesis = estimateRequestMaximumUsd({
      model: plan.model,
      requestBody: body,
      maxOutputTokens: outputTokenCap("synthesis", tier, plan.model),
    });
    assert.ok(
      specialist.maxCostUsd <= plan.budget.specialistsUsd / 4,
      `${tier} specialist ${specialist.maxCostUsd} > ${plan.budget.specialistsUsd / 4}`,
    );
    assert.ok(
      synthesis.maxCostUsd <= plan.budget.synthesisUsd,
      `${tier} synthesis ${synthesis.maxCostUsd} > ${plan.budget.synthesisUsd}`,
    );
  }
});

test("the synthesis is written with low reasoning effort on every level", () => {
  for (const model of Object.values(TIER_MODELS.deep)) {
    assert.equal(synthesisReasoningEffort(model), "low");
  }
});
