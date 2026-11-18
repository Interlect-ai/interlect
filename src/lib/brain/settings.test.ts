import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkModelChange,
  evalApprovesModelSwitch,
  isBudgetScope,
  MODEL_ROLES,
  modelVariant,
  validMonthlyLimitUsd,
} from "./settings.ts";

const passed = (role: (typeof MODEL_ROLES)[number], model: string) => ({
  variant: modelVariant(role, model),
  scores: { passed: true },
});

test("a model switch is only approved by a passed evaluation of exactly that switch", () => {
  const model = "openai/gpt-5.4";
  assert.equal(checkModelChange({ role: "extractor", model, run: null }), "no_eval");
  assert.equal(
    checkModelChange({ role: "extractor", model, run: passed("extractor", model) }),
    null,
  );
  assert.equal(
    checkModelChange({
      role: "extractor",
      model,
      run: { variant: modelVariant("extractor", model), scores: { passed: false } },
    }),
    "eval_not_passed",
  );
  assert.equal(
    checkModelChange({ role: "resolver", model, run: passed("extractor", model) }),
    "eval_not_passed",
    "a run of another role does not approve",
  );
  assert.equal(
    checkModelChange({
      role: "extractor",
      model,
      run: { variant: "prod:retrieval-v1", scores: { recall_at_20: 0.9 } },
    }),
    "eval_not_passed",
    "the retrieval run is not a model evaluation",
  );
  assert.equal(
    checkModelChange({
      role: "extractor",
      model: "openai/gpt-9",
      run: passed("extractor", "openai/gpt-9"),
    }),
    "unknown_model",
  );
  assert.equal(evalApprovesModelSwitch(null, "extractor", model), false);
});

test("budget limits are finite, not negative and capped; scopes are the four known", () => {
  for (const value of [0, 22, 72.5, 1000]) assert.equal(validMonthlyLimitUsd(value), true);
  for (const value of [-1, 1001, Number.NaN, Infinity])
    assert.equal(validMonthlyLimitUsd(value), false);
  assert.equal(isBudgetScope("chat"), true);
  assert.equal(isBudgetScope("everything"), false);
});
