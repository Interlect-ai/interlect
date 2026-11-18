import assert from "node:assert/strict";
import { test } from "node:test";
import { formatByUnit, formatDkkCompact, formatRunway } from "../analysis/financial-format.ts";
import { executionStatusLabelIn, scoreCategoryLabelIn } from "../domain/labels.ts";
import { formatScore } from "./presentation.ts";
import { riskTitle } from "./risk-title.ts";
import { runStepName } from "./run-steps.ts";

test("formatScore follows the fund's language, Danish unchanged", () => {
  assert.equal(formatScore(47.5), "47,5");
  assert.equal(formatScore(47.5, "–", "da"), "47,5");
  assert.equal(formatScore(47.5, "–", "en"), "47.5");
  assert.equal(formatScore(null, "–", "en"), "–");
});

test("run step names are translated", () => {
  const key = "cvr_financials";
  assert.notEqual(runStepName(key, "en"), runStepName(key, "da"));
  assert.equal(runStepName(key), runStepName(key, "da"));
});

test("a risk without a model title uses the English category title", () => {
  const risk = { category: "key_person", label: null };
  assert.notEqual(riskTitle(risk, "en"), riskTitle(risk, "da"));
  assert.equal(riskTitle(risk, "en"), "Key-person risk");
  assert.equal(riskTitle({ category: "key_person", label: "Egen" }, "en"), "Egen");
});

test("financial figures format in English and stay identical in Danish", () => {
  assert.equal(formatDkkCompact(3_400_000), "3,4 mio.");
  assert.equal(formatDkkCompact(3_400_000, "da"), "3,4 mio.");
  assert.equal(formatDkkCompact(3_400_000, "en"), "3.4m");
  assert.equal(formatDkkCompact(1_200_000_000, "en"), "1.2bn");
  assert.equal(formatDkkCompact(-45_000, "en"), "−45k");
  assert.equal(formatRunway(130), "over 10 år");
  assert.equal(formatRunway(130, "en"), "over 10 years");
  assert.equal(formatRunway(18, "en"), "18 mo");
  assert.equal(formatByUnit("percent", 12.5, "da"), "12,5 %");
  assert.equal(formatByUnit("percent", 12.5, "en"), "12.5%");
  assert.equal(formatByUnit("days", 30, "en"), "30 days");
});

test("domain labels exist in both languages", () => {
  assert.equal(executionStatusLabelIn("queued"), "I kø");
  assert.equal(executionStatusLabelIn("queued", "en"), "Queued");
  assert.equal(scoreCategoryLabelIn("financial_strength", "en"), "Financial strength");
  assert.equal(scoreCategoryLabelIn("nope", "en"), undefined);
});
