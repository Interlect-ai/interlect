/** Finanser always shows four figures; a missing one or a run-out runway reads "Ikke oplyst". */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FinancialMetricsReport } from "../analysis/financial-metrics.ts";
import { financeSummary } from "./finance-summary.ts";

const YEARS = ["2022-12-31", "2023-12-31", "2024-12-31"];

function metric(key: string, unit: string, values: Array<number | null>) {
  const series = values.map((value, index) => ({
    periodEnd: YEARS[index]!,
    value,
    status: value === null ? "kan_ikke_beregnes" : "ok",
    inputs: [],
    note: null,
  }));
  return {
    key,
    label: key,
    category: "indtjening",
    unit,
    formula: "f",
    series,
    latest: series.at(-1),
  };
}

function report(metrics: ReturnType<typeof metric>[]): FinancialMetricsReport {
  return {
    version: "interlect-financial-metrics-v1",
    asOf: "2026-09-30",
    years: YEARS,
    metrics,
  } as never;
}

test("four figures, and a runway of 0 months reads Ikke oplyst, never 0 mdr.", () => {
  const summary = financeSummary(
    report([
      metric("gross_profit", "dkk", [10_000_000, 15_000_000, 20_000_000]),
      metric("runway_today", "months", [null, null, 0]),
    ]),
    "da",
  )!;
  assert.deepEqual(
    summary.kpis.map((kpi) => kpi.label),
    ["Bruttofortjeneste 2024", "Vækst", "Bruttomargin", "Runway"],
  );
  assert.equal(summary.kpis[1]!.value, "Ikke oplyst");
  assert.equal(summary.kpis[3]!.value, "Ikke oplyst");
  assert.equal(summary.headline.label, "Bruttofortjeneste 2024");
  assert.equal(summary.hasRevenue, false);
});

test("revenue leads the card and the chart when the reports have it", () => {
  const summary = financeSummary(
    report([
      metric("revenue", "dkk", [30_000_000, 40_000_000, 50_000_000]),
      metric("gross_profit", "dkk", [10_000_000, 15_000_000, 20_000_000]),
    ]),
    "en",
  )!;
  assert.equal(summary.headline.label, "Revenue 2024");
  assert.equal(summary.hasRevenue, true);
  assert.equal(summary.kpis[3]!.value, "Not reported");
});
