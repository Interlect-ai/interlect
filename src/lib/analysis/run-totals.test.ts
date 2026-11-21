/**
 * A finished run's price is its steps' sum, so the reconciliation finds steps = run. In
 * October five deep analyses in "Interlect Demo" were about 0.8 kr. under their steps: the direct
 * runner (development, so also staging-live and the demo team) added up its own calls and left the
 * evidence sheet out. One screening's fund-fit step left no charge for an unknown price.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { runTotalsFromSteps, sumCompleteCosts } from "./gateway-response.ts";

const read = (file: string) => readFileSync(resolve("src/lib/analysis", file), "utf8");

const step = (actual: number | null, charged: number | null = null, tokens = 0) => ({
  actual_cost: actual,
  charged_cost: charged,
  input_tokens: tokens,
  output_tokens: tokens,
  total_tokens: tokens * 2,
});

// Deep analysis b28c0de2 on staging: its steps in order, with the evidence sheet.
const OCTOBER_DEEP = [
  { key: "public_research", usd: 0.27911 },
  { key: "cvr_financials", usd: 0 },
  { key: "evidence_sheet", usd: 0.11032 },
  { key: "people_team", usd: 0.201195 },
  { key: "product_market_gtm", usd: 0.2334975 },
  { key: "technology_risk", usd: 0.201865 },
  { key: "fund_finance_deal", usd: 0.22853 },
  { key: "custom_8an32liol8i6", usd: 0.18604 },
  { key: "investment_committee_synthesis", usd: 0.274065 },
];

test("the run's price is every step's price, the evidence sheet included", () => {
  const totals = runTotalsFromSteps(OCTOBER_DEEP.map((row) => step(row.usd)));
  const stepsUsd = OCTOBER_DEEP.reduce((sum, row) => sum + row.usd, 0);
  assert.ok(Math.abs((totals.actualUsd ?? 0) - stepsUsd) < 1e-9);
  // What the direct runner wrote then: research, specialists and synthesis, no sheet (1.6043025).
  const before = sumCompleteCosts(
    OCTOBER_DEEP.filter((row) => row.key !== "evidence_sheet").map((row) => row.usd),
  );
  assert.ok(Math.abs(stepsUsd - (before ?? 0) - 0.11032) < 1e-9);
  assert.equal(totals.chargedUsd, totals.actualUsd);
  assert.equal(totals.knownUsd, totals.actualUsd);
});

test("an unknown price makes the run's price unknown, and the charge carries it", () => {
  const totals = runTotalsFromSteps([step(0.1, 0.1), step(null, 0.3), step(0)]);
  assert.equal(totals.actualUsd, null);
  assert.ok(Math.abs((totals.chargedUsd ?? 0) - 0.4) < 1e-9);
  assert.ok(Math.abs(totals.knownUsd - 0.1) < 1e-9);
  // A step with neither (saved before 0116) leaves the charge unbound, as the worker always did.
  assert.equal(runTotalsFromSteps([step(0.1), step(null)]).chargedUsd, null);
  // Prices read back as text (numeric columns) count as numbers.
  const text = runTotalsFromSteps([
    { ...step(null), actual_cost: "0.25", charged_cost: "0.25" },
    step(0.5),
  ]);
  assert.equal(text.actualUsd, 0.75);
});

test("the run's tokens are its steps' tokens", () => {
  const totals = runTotalsFromSteps([
    step(0, null, 10),
    { ...step(0), input_tokens: 3, output_tokens: 4, total_tokens: null },
  ]);
  assert.equal(totals.inputTokens, 13);
  assert.equal(totals.outputTokens, 14);
  assert.equal(totals.totalTokens, 27);
});

test("both deep runners write the run's price from its steps, and every step keeps its charge", () => {
  const worker = read("deep-worker.server.ts");
  const direct = read("deep.functions.ts");
  for (const source of [worker, direct]) assert.match(source, /runTotalsFromSteps\(/);
  // The direct runner no longer adds up its own calls for the run.
  assert.doesNotMatch(direct, /let totalCostUsd = sumCompleteCosts/);
  assert.match(direct, /actual_cost: totals\.actualUsd/);
  assert.match(direct, /chargedUsd: totals\.chargedUsd/);
  // Research, taken-over and called specialists, and the synthesis keep their charge.
  assert.match(direct, /charged_cost: publicResearch\.budgetChargeUsd/);
  assert.match(direct, /charged_cost: 0,\n\s+output_json: reusablePacket/);
  assert.match(direct, /charged_cost: budgetCharge\(\n\s+completion\.actualCostUsd/);
  assert.match(direct, /charged_cost: chargedSynthesisUsd/);
});

test("the screening's fund-fit step keeps its charge, also when it fails", () => {
  const screening = read("screening-analysis.server.ts");
  assert.match(
    screening,
    /charged_cost: budgetCharge\(completion\.actualCostUsd, completion\.estimatedMaximumUsd\)/,
  );
  assert.match(screening, /\{ charged_cost: stepChargeUsd \}/);
});
