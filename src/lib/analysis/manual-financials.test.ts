import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFinancialMetrics, type MetricsStatementInput } from "./financial-metrics.ts";
import {
  MANUAL_SOURCE,
  inputYearAllowed,
  maxInputYear,
  withManualInputs,
} from "./manual-financials.ts";

const report2024: MetricsStatementInput = {
  periodStart: "2024-01-01",
  periodEnd: "2024-12-31",
  sourceDocumentUrl: "https://example.test/2024.pdf",
  reportingClassText: "B",
  lineItems: [
    { metric: "gross_profit", value: 4_000_000 },
    { metric: "cash", value: 2_000_000 },
  ],
};

const dkk = (
  metric: "revenue" | "gross_profit" | "cash" | "cash_flow_operating",
  fiscalYear: number,
  value: number,
) => ({
  metric,
  fiscalYear,
  value,
  currency: "DKK",
});

test("an entered figure fills a gap in the report; the report's own figure always wins", () => {
  const [merged] = withManualInputs(
    [report2024],
    [dkk("revenue", 2024, 10_000_000), dkk("gross_profit", 2024, 1)],
  );
  assert.deepEqual(
    merged!.lineItems.map((item) => [item.metric, item.value, item.source ?? "report"]),
    [
      ["gross_profit", 4_000_000, "report"],
      ["cash", 2_000_000, "report"],
      ["revenue", 10_000_000, MANUAL_SOURCE],
    ],
  );
  // The input statement is not changed.
  assert.equal(report2024.lineItems.length, 2);
});

test("a year without a report becomes a calendar year of its own; growth is calculated in code", () => {
  const statements = withManualInputs(
    [report2024],
    [dkk("revenue", 2023, 8_000_000), dkk("revenue", 2024, 10_000_000)],
  );
  const report = computeFinancialMetrics(statements, "2025-03-15");
  assert.deepEqual(report.years, ["2023-12-31", "2024-12-31"]);
  const growth = report.metrics.find((metric) => metric.key === "revenue_growth");
  assert.equal(growth?.latest?.value, 25);
  const revenue = report.metrics.find((metric) => metric.key === "revenue");
  assert.equal(revenue?.latest?.inputs[0]?.sourceDocumentUrl, MANUAL_SOURCE);
  // The gross margin 2024 uses the report's gross profit and the entered revenue.
  const margin = report.metrics.find((metric) => metric.key === "gross_margin");
  const margin2024 = margin?.series.find((point) => point.periodEnd === "2024-12-31");
  assert.equal(margin2024?.value, 40);
  assert.deepEqual(
    margin2024?.inputs.map((input) => input.sourceDocumentUrl).sort(),
    [MANUAL_SOURCE, "https://example.test/2024.pdf"].sort(),
  );
});

test("no reports at all: entered figures alone give the key figures", () => {
  const report = computeFinancialMetrics(
    withManualInputs([], [dkk("revenue", 2025, 8_000_000), dkk("gross_profit", 2025, 2_000_000)]),
    "2026-01-15",
  );
  const margin = report.metrics.find((metric) => metric.key === "gross_margin");
  assert.equal(margin?.latest?.value, 25);
});

test("a figure in another currency than the reports' is not used", () => {
  const statements = withManualInputs(
    [report2024],
    [{ metric: "revenue", fiscalYear: 2024, value: 1, currency: "EUR" }],
  );
  assert.equal(statements[0]!.lineItems.length, 2);
  assert.equal(statements.length, 1);
});

test("a year after the newest report is never used, so it cannot hide the report's figures", () => {
  const statements = withManualInputs([report2024], [dkk("cash", 2025, 1_000_000)]);
  assert.equal(statements.length, 1);
  assert.equal(statements[0]!.lineItems.length, 2);
});

test("which years can be entered", () => {
  const now = Date.UTC(2026, 9, 15);
  assert.equal(maxInputYear([report2024], now), 2024);
  assert.equal(maxInputYear([], now), 2025);
  assert.equal(maxInputYear([{ periodEnd: "2026-06-30" }], now), 2026);
  assert.ok(inputYearAllowed(2020, [report2024], now));
  assert.ok(!inputYearAllowed(2025, [report2024], now));
  assert.ok(!inputYearAllowed(2026, [], now));
  assert.ok(!inputYearAllowed(1989, [], now));
});
