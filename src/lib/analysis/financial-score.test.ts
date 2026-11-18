/** Test af kode-scoren for finansiel styrke (C8). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialMetrics, type MetricsStatementInput } from "./financial-metrics.ts";
import {
  applyCurve,
  blendFinancialScore,
  computeFinancialScore,
  CURVES,
  financialScoreConfidence,
  financialScoreRationale,
  withoutMethodNote,
  stageWeights,
} from "./financial-score.ts";

function statement(periodEnd: string, items: Record<string, number>): MetricsStatementInput {
  return {
    periodStart: `${periodEnd.slice(0, 4)}-01-01`,
    periodEnd,
    sourceDocumentUrl: "https://regnskaber.virk.dk/test",
    reportingClassText: "Reporting class B",
    lineItems: Object.entries(items).map(([metric, value]) => ({ metric, value })),
  };
}

test("kurver er stykkevis lineære og flade uden for punkterne", () => {
  const curve: Array<[number, number]> = [
    [0, 35],
    [15, 60],
  ];
  assert.equal(applyCurve(curve, -5), 35);
  assert.equal(applyCurve(curve, 7.5), 47.5);
  assert.equal(applyCurve(curve, 30), 60);
});

test("kurverne følger research 02 afsnit 6 punkt for punkt", () => {
  assert.deepEqual(CURVES.growth, [
    [-10, 10],
    [0, 35],
    [15, 60],
    [40, 85],
    [80, 95],
  ]);
  assert.deepEqual(CURVES.ebitda_margin, [
    [-30, 15],
    [0, 45],
    [10, 65],
    [20, 85],
    [30, 95],
  ]);
  assert.deepEqual(CURVES.equity_ratio, [
    [0, 5],
    [10, 30],
    [30, 65],
    [50, 85],
  ]);
  assert.deepEqual(CURVES.runway, [
    [6, 10],
    [12, 50],
    [18, 70],
    [24, 90],
  ]);
  assert.deepEqual(CURVES.current_ratio, [
    [0.8, 20],
    [1, 45],
    [1.5, 70],
    [2, 85],
  ]);
});

test("vægtene summer til 100 for alle stadier", () => {
  for (const stage of ["pre_seed", "seed", "series_a", "series_b", "later", null]) {
    const sum = Object.values(stageWeights(stage)).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100, String(stage));
  }
});

const report = computeFinancialMetrics(
  [
    statement("2023-12-31", {
      revenue: 4_000_000,
      gross_profit: 1_000_000,
      equity: 600_000,
      net_result: 50_000,
    }),
    statement("2024-12-31", {
      revenue: 4_600_000,
      gross_profit: 1_150_000,
      operating_result: 100_000,
      depreciation: 20_000,
      net_result: 80_000,
      equity: 680_000,
      assets: 2_000_000,
      current_assets: 1_200_000,
      shortterm_liabilities: 1_000_000,
      cash: 300_000,
    }),
  ],
  "2025-06-30",
);

test("et profitabelt selskab får en kode-score med fuld dækning", () => {
  const result = computeFinancialScore(report, "later");
  assert.equal(result.coverage, 1);
  assert.ok(result.score !== null && result.score > 40 && result.score < 80, String(result.score));
});

test("margin målt mod bruttofortjeneste (klasse B) udelades af kode-scoren", () => {
  const classB = computeFinancialMetrics(
    [
      statement("2024-12-31", {
        gross_profit: 1_150_000,
        operating_result: 400_000,
        depreciation: 20_000,
        equity: 680_000,
        assets: 2_000_000,
        current_assets: 1_200_000,
        shortterm_liabilities: 1_000_000,
        cash: 300_000,
      }),
    ],
    "2025-06-30",
  );
  const result = computeFinancialScore(classB, "later");
  const margin = result.components.find((item) => item.key === "ebitda_margin")!;
  assert.equal(margin.value, null);
  assert.ok(result.coverage < 1);
});

test("selvfinansierende selskab scorer runway som 24 måneder (90)", () => {
  const result = computeFinancialScore(report, "later");
  const runway = result.components.find((item) => item.key === "runway")!;
  assert.equal(runway.value, 24);
  assert.equal(runway.score, 90);
});

test("tillid stiger med dækning og falder ved gammelt regnskab", () => {
  assert.equal(financialScoreConfidence(1, 6), 0.8);
  assert.equal(financialScoreConfidence(0.5, 6), 0.6);
  assert.equal(financialScoreConfidence(1, 30), 0.6);
});

test("begrundelsen nævner kode-scoren og en eventuel AI-justering", () => {
  const result = computeFinancialScore(report, "later");
  const plain = financialScoreRationale(result, result.score!, null);
  assert.match(plain, /^[A-ZÆØÅ].* \(CVR-regnskabet\) giver /);
  assert.doesNotMatch(plain, /i kode/);
  const adjusted = financialScoreRationale(result, result.score! - 5, "Svag likviditet.");
  assert.match(adjusted, /giver [\d.,]+\. Svag likviditet\.$/);
  assert.doesNotMatch(adjusted, /Justeret|evidensen/);
});

test("ældre gemte begrundelser vises uden metodeteksten (T-968)", () => {
  assert.equal(
    withoutMethodNote(
      "Regnet i kode fra CVR-regnskabet: soliditet 60 % giver 72. Justeret -5 ud fra evidensen: Svag likviditet.",
    ),
    "Soliditet 60 % giver 72. Svag likviditet.",
  );
  assert.equal(
    withoutMethodNote(
      "Calculated in code from the registry's annual report: equity ratio 60% gives 72. Adjusted +2.5 based on the evidence: Strong cash.",
    ),
    "Equity ratio 60% gives 72. Strong cash.",
  );
  assert.equal(withoutMethodNote("Stærkt team."), "Stærkt team.");
});

test("seed straffes ikke for vækst og margin (vægt 0)", () => {
  const result = computeFinancialScore(report, "seed");
  const growth = result.components.find((item) => item.key === "growth")!;
  assert.equal(growth.weight, 0);
});

test("for lidt data giver ingen kode-score", () => {
  const thin = computeFinancialMetrics([statement("2024-12-31", { cash: 100 })], "2025-06-30");
  const result = computeFinancialScore(thin, "later");
  assert.equal(result.score, null);
  assert.ok(result.coverage < 0.5);
});

test("hybrid: AI kan højst flytte scoren ±10", () => {
  assert.equal(blendFinancialScore(60, 90), 70);
  assert.equal(blendFinancialScore(60, 30), 50);
  assert.equal(blendFinancialScore(60, 64), 64);
  assert.equal(blendFinancialScore(60, null), 60);
});
