/**
 * The key figures, finance gates, finance score, deck finance and the fallback
 * findings follow the fund's language; Danish (the default) is unchanged. Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialMetrics, type MetricsStatementInput } from "./financial-metrics.ts";
import { evaluateFinanceGate } from "./financial-gates.ts";
import { computeFinancialScore, financialScoreRationale } from "./financial-score.ts";
import { calculateFinance } from "./finance.ts";
import { categoryFallbackWarning, unknownFindingFor } from "./finding-categories.ts";
import { gateAnswerFromTask } from "./gate-answers.ts";
import { auditDeepTextLengths } from "./deep-text-rules.ts";
import { DICTIONARIES } from "../i18n/translate.ts";
import {
  BudgetExceededError,
  assertActualSpendWithinBudget,
  assertWithinBudget,
} from "./budgets.ts";

function statement(periodEnd: string, items: Record<string, number>): MetricsStatementInput {
  return {
    periodStart: `${periodEnd.slice(0, 4)}-01-01`,
    periodEnd,
    sourceDocumentUrl: "https://regnskaber.virk.dk/test",
    reportingClassText: "Reporting class B",
    lineItems: Object.entries(items).map(([metric, value]) => ({ metric, value })),
  };
}

const statements = [
  statement("2023-12-31", { equity: 100_000, net_result: -50_000, revenue: 1_000_000 }),
  statement("2024-12-31", {
    equity: -200_000,
    net_result: -300_000,
    cash: 50_000,
    revenue: 1_200_000,
    assets: 400_000,
  }),
];

test("English report: names, formulas and notes in English; Danish stays the default", () => {
  const english = computeFinancialMetrics(statements, "2025-06-30", { language: "en" });
  const danish = computeFinancialMetrics(statements, "2025-06-30");
  const revenue = (report: typeof english) => report.metrics.find((m) => m.key === "revenue")!;
  assert.equal(english.language, "en");
  assert.equal(danish.language, undefined);
  assert.equal(revenue(english).label, "Net revenue");
  assert.equal(revenue(english).formula, "Net revenue as reported");
  assert.equal(revenue(danish).label, "Nettoomsætning");
  const burn = english.metrics.find((m) => m.key === "operating_burn")!.latest!;
  assert.match(burn.note!, /^Estimate from the income statement/);
  const ebitda = english.metrics.find((m) => m.key === "ebitda")!.latest!;
  assert.match(ebitda.note!, /is not reported for the year\.$/);
  assert.doesNotMatch(ebitda.note!, /[æøå]| og /);
  // A Danish report right after an English one is Danish again (the language never leaks).
  assert.equal(
    computeFinancialMetrics(statements, "2025-06-30").metrics[0]!.label,
    "Nettoomsætning",
  );
});

test("finance gates write their rationale in the context's language", () => {
  const report = computeFinancialMetrics(statements, "2025-06-30", { language: "en" });
  const english = evaluateFinanceGate("finance_positive_equity", {
    report,
    identityConfirmed: true,
    stage: "seed",
    language: "en",
  });
  assert.match(english.rationale, /^Equity was −200,000 DKK at .*2024 \(CVR annual report\)\./);
  const danish = evaluateFinanceGate("finance_positive_equity", {
    report: computeFinancialMetrics(statements, "2025-06-30"),
    identityConfirmed: true,
    stage: "seed",
  });
  assert.match(danish.rationale, /^Egenkapitalen var −200\.000 kr\. pr\. /);
});

test("the finance score's labels and rationale follow the report's language", () => {
  const healthy = [
    statement("2023-12-31", { revenue: 1_000_000, equity: 500_000, assets: 1_000_000 }),
    statement("2024-12-31", {
      revenue: 1_500_000,
      equity: 600_000,
      assets: 1_000_000,
      current_assets: 600_000,
      shortterm_liabilities: 300_000,
      operating_result: 200_000,
      depreciation: 10_000,
      net_result: 150_000,
      cash: 300_000,
    }),
  ];
  const score = computeFinancialScore(
    computeFinancialMetrics(healthy, "2025-06-30", { language: "en" }),
    "seed",
  );
  assert.equal(score.language, "en");
  assert.ok(score.components.some((item) => item.label === "Growth"));
  const rationale = financialScoreRationale(score, score.score! - 2.5, "Weak liquidity.");
  assert.match(rationale, /^Equity ratio 60%/);
  assert.match(rationale, /current ratio 2\.00 \(CVR annual report\) gives \d/);
  assert.match(rationale, /\. Weak liquidity\.$/);
  assert.doesNotMatch(rationale, /in code|Adjusted/);
});

test("deck finance, fallback findings, gate answers and length checks in English", () => {
  const results = calculateFinance([{ id: "a", metric: "mrr", value: 10, unit: "EUR" }], "en");
  assert.equal(results.find((item) => item.metric === "mrr")!.unit, "EUR/month");
  assert.equal(
    calculateFinance([{ id: "a", metric: "mrr", value: 10, unit: "DKK" }]).find(
      (item) => item.metric === "mrr",
    )!.unit,
    "DKK/måned",
  );
  const noCurrency = calculateFinance([{ id: "a", metric: "mrr", value: 10, unit: "" }], "en");
  assert.equal(noCurrency.find((item) => item.metric === "mrr")!.unit, "unknown currency/month");
  assert.match(unknownFindingFor("market_timing", "en").statement, /^No data found for market/);
  assert.match(unknownFindingFor("market_timing").statement, /^Ingen data fundet for markedets/);
  assert.match(categoryFallbackWarning(["traction_gtm"], [], "en")[0]!, /^There was no finding/);
  const answer = gateAnswerFromTask(
    {
      linked_key: "gate_a",
      answer_value: { gatePassed: false },
      answer_text: null,
      answer_evidence_id: null,
      resolved_at: "2026-10-01T00:00:00Z",
    } as unknown as Parameters<typeof gateAnswerFromTask>[0],
    "en",
  );
  assert.equal(answer?.rationale, "The team's answer: Not met");
  const audit = auditDeepTextLengths({ assessments: [], overallAssessment: "kort" }, "en");
  assert.match(audit.blockingErrors[0]!, /^The overall assessment is too short/);
});

test("every key the analysis reads has a Danish and an English text", () => {
  const groups = [
    "metrics",
    "statements",
    "gates",
    "finance",
    "financeScore",
    "scoring",
    "specialistSet",
    "tiers",
    "deepText",
    "findings",
    "gateAnswers",
  ] as const;
  const keys = (node: unknown, prefix = ""): string[] =>
    typeof node === "string"
      ? [prefix]
      : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
          keys(value, prefix ? `${prefix}.${key}` : key),
        );
  for (const group of groups) {
    assert.deepEqual(
      keys(DICTIONARIES.en.analysisServer[group]).sort(),
      keys(DICTIONARIES.da.analysisServer[group]).sort(),
      group,
    );
  }
});

test("a step stopped by its cap says so in the run's language, without an amount (T-623)", () => {
  const estimate = { maxCostUsd: 0.12, maxInputTokens: 1000, maxOutputTokens: 500 };
  const silence = console.warn;
  console.warn = () => {};
  try {
    assert.throws(
      () => assertWithinBudget(estimate, 0.05, "Researchplanen", "da"),
      (error: unknown) =>
        error instanceof BudgetExceededError && error.message === "Trinnet stoppede ved sit loft.",
    );
    assert.throws(
      () => assertWithinBudget(estimate, 0.05, "Researchplanen", "en"),
      (error: unknown) =>
        error instanceof Error && error.message === "The step stopped at its limit.",
    );
    assert.throws(
      () => assertActualSpendWithinBudget(0.3, 0.2, "Den offentlige research", "en"),
      (error: unknown) => error instanceof Error && !/\$|research/i.test(error.message),
    );
  } finally {
    console.warn = silence;
  }
});
