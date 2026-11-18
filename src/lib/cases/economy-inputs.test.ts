import { test } from "node:test";
import assert from "node:assert/strict";
import { KPI_INPUTS, defaultInputYear, missingFigures, parseAmount } from "./economy-inputs.ts";

test("amounts the way people type them", () => {
  assert.equal(parseAmount("1.250.000"), 1_250_000);
  assert.equal(parseAmount("1,250,000"), 1_250_000);
  assert.equal(parseAmount("1 250 000 kr."), 1_250_000);
  assert.equal(parseAmount("-850.000"), -850_000);
  assert.equal(parseAmount("−850.000"), -850_000);
  assert.equal(parseAmount("1,5 mio."), 1_500_000);
  assert.equal(parseAmount("2 mia"), 2_000_000_000);
  assert.equal(parseAmount("12.5"), 12.5);
  assert.equal(parseAmount("0"), 0);
  assert.equal(parseAmount("-0"), 0);
  assert.equal(parseAmount("1.5m"), 1_500_000);
  assert.equal(parseAmount("5m"), 5_000_000);
  assert.equal(parseAmount("2k"), 2_000);
  assert.equal(parseAmount("1,5mio"), 1_500_000);
  assert.equal(parseAmount("kr -850.000"), -850_000);
  assert.equal(parseAmount("DKK -1.000"), -1_000);
  assert.equal(parseAmount("(850.000)"), -850_000);
  assert.equal(parseAmount("1.000.000,123"), 1_000_000.123);
  assert.equal(parseAmount("1.250"), 1_250);
  assert.equal(parseAmount("1,5"), 1.5);
});

test("nothing sensible is never a number", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("ukendt"), null);
  assert.equal(parseAmount("9".repeat(20)), null);
  assert.equal(parseAmount("1e5"), null);
  assert.equal(parseAmount("2 mio k"), null);
  assert.equal(parseAmount("12 34"), null);
});

test("the default year is the latest report's, else last calendar year", () => {
  assert.equal(defaultInputYear(["2023-12-31", "2024-06-30"], Date.UTC(2026, 9, 15)), 2024);
  assert.equal(defaultInputYear([], Date.UTC(2026, 9, 15)), 2025);
});

test("Find med Brain only looks for the raw figures a year is missing", () => {
  const statements = [
    { periodEnd: "2024-12-31", lineItems: [{ metric: "revenue" }, { metric: "net_result" }] },
    { periodEnd: "2023-12-31", lineItems: [{ metric: "gross_profit" }] },
  ];
  // 2024 has revenue from the report: only gross profit is missing for the margin.
  assert.deepEqual(missingFigures(KPI_INPUTS.gross_margin, 2024, statements, []), ["gross_profit"]);
  assert.deepEqual(missingFigures(KPI_INPUTS.revenue, 2024, statements, []), []);
  // An entered figure counts as found, for that year only.
  const inputs = [{ metric: "cash" as const, fiscalYear: 2024 }];
  assert.deepEqual(missingFigures(KPI_INPUTS.runway_today, 2024, statements, inputs), [
    "cash_flow_operating",
  ]);
  assert.deepEqual(missingFigures(KPI_INPUTS.runway_today, 2023, statements, inputs), [
    "cash",
    "cash_flow_operating",
  ]);
  // Without any reports every raw figure of the key figure is missing.
  assert.deepEqual(missingFigures(KPI_INPUTS.gross_margin, 2025, [], []), [
    "gross_profit",
    "revenue",
  ]);
});
