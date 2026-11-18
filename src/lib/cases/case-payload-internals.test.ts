/**
 * (beslutningslog 15. okt): the case page's data never carries the AI's model, prompt
 * version, tokens or price to the customer's browser, where they could be read in the developer
 * tools. They stay in the database for the internal pages and operations. This test fails if a
 * column or field comes back in the case payload (`cases.functions.ts`) or its view model
 * (`view-model.ts`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const HERE = import.meta.dirname;

// validation_result also holds the model, budget and price (read validation_public instead).
const FORBIDDEN_COLUMNS =
  /\b(model_name|prompt_template_version|prompt_version|workflow_version|token_usage|input_tokens|output_tokens|total_tokens|actual_cost|validation_result|idempotency_key)\b/;
const FORBIDDEN_FIELDS =
  /\b(modelName|promptVersion|workflowVersion|tokenUsage|inputTokens|outputTokens|totalTokens|actualCostUsd)\b/;

test("the case payload selects no model, prompt version, tokens or price", () => {
  const source = readFileSync(resolve(HERE, "cases.functions.ts"), "utf8");
  assert.doesNotMatch(source, FORBIDDEN_COLUMNS);
  assert.doesNotMatch(source, FORBIDDEN_FIELDS);
  // A select("*") would bring every column back without naming one.
  assert.doesNotMatch(source, /select\(\s*["'`]\*/);
});

test("the case view model carries none of them either", () => {
  const source = readFileSync(resolve(HERE, "view-model.ts"), "utf8");
  assert.doesNotMatch(source, FORBIDDEN_FIELDS);
});
