/**
 * Test af nøgletalsmotoren. Kør: node --test src/lib/analysis/financial-metrics.test.ts
 * (Node 24 læser TypeScript direkte). Tallene er valgt, så facit kan regnes i hånden.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compactFinancialMetrics,
  computeFinancialMetrics,
  type FinancialMetricsReport,
  type MetricsStatementInput,
} from "./financial-metrics.ts";

const SOURCE = "https://regnskaber.virk.dk/test";

function statement(periodEnd: string, items: Record<string, number>): MetricsStatementInput {
  return {
    periodStart: `${Number(periodEnd.slice(0, 4))}-01-01`,
    periodEnd,
    sourceDocumentUrl: SOURCE,
    reportingClassText: "Reporting class B",
    lineItems: Object.entries(items).map(([metric, value]) => ({ metric, value })),
  };
}

function metric(report: FinancialMetricsReport, key: string) {
  const found = report.metrics.find((item) => item.key === key);
  assert.ok(found, `nøgletal ${key} mangler`);
  return found;
}

// Et profitabelt klasse B-selskab uden omsætning, fire år.
const profitable = computeFinancialMetrics(
  [
    statement("2021-12-31", {
      gross_profit: 1_000_000,
      equity: 400_000,
      assets: 1_000_000,
      net_result: 100_000,
    }),
    statement("2022-12-31", {
      gross_profit: 1_200_000,
      equity: 500_000,
      assets: 1_100_000,
      net_result: 150_000,
    }),
    statement("2023-12-31", {
      gross_profit: 1_500_000,
      equity: 700_000,
      assets: 1_300_000,
      net_result: 200_000,
    }),
    statement("2024-12-31", {
      gross_profit: 2_000_000,
      employee_expense: 1_200_000,
      operating_result: 400_000,
      depreciation: 50_000,
      finance_expenses: -20_000,
      net_result: 300_000,
      equity: 1_000_000,
      contributed_capital: 40_000,
      assets: 2_000_000,
      liabilities_and_equity: 2_000_000,
      liabilities: 1_000_000,
      current_assets: 900_000,
      shortterm_liabilities: 600_000,
      cash: 500_000,
      average_employees: 4,
    }),
  ],
  "2025-06-30",
);

test("år sorteres ældste først, og antal regnskabsår tælles", () => {
  assert.deepEqual(profitable.years, ["2021-12-31", "2022-12-31", "2023-12-31", "2024-12-31"]);
  assert.equal(metric(profitable, "filing_count").latest?.value, 4);
});

test("bruttomargin kan ikke beregnes uden omsætning (klasse B)", () => {
  const margin = metric(profitable, "gross_margin").latest!;
  assert.equal(margin.status, "kan_ikke_beregnes");
  assert.equal(margin.value, null);
  assert.match(margin.note ?? "", /Nettoomsætning er ikke indberettet/);
});

test("EBITDA = EBIT + afskrivninger, og marginen måles mod bruttofortjenesten med note", () => {
  assert.equal(metric(profitable, "ebitda").latest?.value, 450_000);
  const margin = metric(profitable, "ebitda_margin").latest!;
  assert.equal(margin.value, 22.5);
  assert.match(margin.note ?? "", /bruttofortjeneste/);
});

test("vækst, CAGR, soliditet, ROE og likviditetsgrad regnes korrekt", () => {
  assert.equal(metric(profitable, "gross_profit_growth").latest?.value, 33.33);
  // (2.000.000 / 1.000.000)^(1/3) − 1 = 25,99 %
  assert.equal(metric(profitable, "gross_profit_cagr_3y").latest?.value, 25.99);
  assert.equal(metric(profitable, "gross_profit_cagr_3y").series[2]?.status, "kan_ikke_beregnes");
  assert.equal(metric(profitable, "equity_ratio").latest?.value, 50);
  // 300.000 / ((1.000.000 + 700.000) / 2) = 35,29 %
  assert.equal(metric(profitable, "return_on_equity").latest?.value, 35.29);
  assert.equal(metric(profitable, "current_ratio").latest?.value, 1.5);
  assert.equal(metric(profitable, "interest_coverage").latest?.value, 20);
  assert.equal(metric(profitable, "personnel_share").latest?.value, 60);
  assert.equal(metric(profitable, "balance_check").latest?.value, 0);
});

test("kapitaltilførsel er et estimat fra egenkapitalbevægelsen", () => {
  const injection = metric(profitable, "capital_injection").latest!;
  // 1.000.000 − 700.000 − 300.000 = 0
  assert.equal(injection.value, 0);
  assert.equal(injection.status, "estimat");
});

test("et profitabelt selskab brænder ikke penge, så runway er ikke relevant", () => {
  assert.equal(metric(profitable, "operating_burn").latest?.value, 0);
  assert.equal(metric(profitable, "runway_today").latest?.status, "kan_ikke_beregnes");
});

test("nettogæld/EBITDA kan aldrig gættes, når gælden ikke er opdelt", () => {
  const nibd = metric(profitable, "nibd_to_ebitda").latest!;
  assert.equal(nibd.status, "kan_ikke_beregnes");
  assert.equal(nibd.value, null);
});

// Et underskudsselskab med burn og en kapitalrejsning.
const burning = computeFinancialMetrics(
  [
    statement("2023-12-31", { equity: 1_000_000, net_result: -800_000 }),
    statement("2024-12-31", {
      net_result: -1_150_000,
      depreciation: 50_000,
      cash: 2_200_000,
      equity: 2_850_000,
      contributed_capital: 50_000,
    }),
  ],
  "2025-06-30",
);

test("burn og runway ved balancedagen og i dag", () => {
  // burn = −(−1.150.000 + 50.000) = 1.100.000 pr. år = 91.666,67 pr. måned
  assert.equal(metric(burning, "operating_burn").latest?.value, 91_666.67);
  // 2.200.000 / 91.666,67 = 24 mdr.
  assert.equal(metric(burning, "runway_at_balance_date").latest?.value, 24);
  const today = metric(burning, "runway_today").latest!;
  assert.equal(today.status, "estimat");
  // ca. 6 måneder siden balancedagen
  assert.ok(today.value !== null && today.value > 17.9 && today.value < 18.1, String(today.value));
});

test("afledt kapitaltilførsel fanger en kapitalrejsning", () => {
  // 2.850.000 − 1.000.000 − (−1.150.000) = 3.000.000
  assert.equal(metric(burning, "capital_injection").latest?.value, 3_000_000);
});

test("vækst i % er ikke meningsfuld fra et negativt udgangspunkt", () => {
  const report = computeFinancialMetrics(
    [
      statement("2023-12-31", { gross_profit: -200_000 }),
      statement("2024-12-31", { gross_profit: 300_000 }),
    ],
    "2025-06-30",
  );
  const growth = metric(report, "gross_profit_growth").latest!;
  assert.equal(growth.status, "kan_ikke_beregnes");
  assert.match(growth.note ?? "", /negativ året før/);
});

test("ingen regnskaber giver en tom rapport, ikke en fejl", () => {
  const empty = computeFinancialMetrics([], "2025-06-30");
  assert.deepEqual(empty.metrics, []);
});

test("hvert punkt har input med kilde og år", () => {
  const ebitda = metric(profitable, "ebitda").latest!;
  assert.equal(ebitda.inputs.length, 2);
  for (const item of ebitda.inputs) {
    assert.equal(item.sourceDocumentUrl, SOURCE);
    assert.equal(item.periodEnd, "2024-12-31");
  }
});

test("runway over 10 år vises som 120 mdr. med note (næsten intet burn)", () => {
  const nearZeroBurn = computeFinancialMetrics(
    [statement("2024-12-31", { net_result: -1_010_000, depreciation: 1_000_000, cash: 5_000_000 })],
    "2025-06-30",
  );
  const runway = metric(nearZeroBurn, "runway_at_balance_date").latest!;
  assert.equal(runway.value, 120);
  assert.match(runway.note ?? "", /Over 10 år/);
});

function period(
  periodStart: string,
  periodEnd: string,
  items: Record<string, number>,
): MetricsStatementInput {
  return { ...statement(periodEnd, items), periodStart };
}

test("samme regnskabsår med 28. og 29. februar tælles én gang, og tal fra begge bevares", () => {
  const report = computeFinancialMetrics(
    [
      period("2023-03-01", "2024-02-28", { gross_profit: 1_000_000, average_employees: 5 }),
      period("2023-03-01", "2024-02-29", { gross_profit: 1_000_000, equity: 400_000 }),
      period("2024-03-01", "2025-02-28", { gross_profit: 1_100_000, equity: 450_000 }),
    ],
    "2025-06-30",
  );
  assert.equal(report.years.length, 2);
  assert.equal(metric(report, "filing_count").latest?.value, 2);
  assert.equal(metric(report, "employees").series[0]?.value, 5);
  assert.equal(metric(report, "gross_profit_growth").latest?.value, 10);
});

test("et omlagt regnskabsår (6 måneder) giver ingen vækstsammenligning", () => {
  const report = computeFinancialMetrics(
    [
      period("2023-01-01", "2023-12-31", { gross_profit: 1_000_000 }),
      period("2024-01-01", "2024-06-30", { gross_profit: 500_000 }),
    ],
    "2025-06-30",
  );
  const growth = metric(report, "gross_profit_growth").latest!;
  assert.equal(growth.status, "kan_ikke_beregnes");
  assert.match(growth.note ?? "", /ikke 12 måneder/);
});

test("et manglende år imellem bryder sammenligningen (ingen falsk år-til-år)", () => {
  const report = computeFinancialMetrics(
    [
      statement("2021-12-31", { gross_profit: 1_000_000, equity: 100_000, net_result: 10_000 }),
      statement("2023-12-31", { gross_profit: 2_000_000, equity: 500_000, net_result: 50_000 }),
    ],
    "2025-06-30",
  );
  assert.equal(metric(report, "gross_profit_growth").latest?.status, "kan_ikke_beregnes");
  assert.equal(metric(report, "capital_injection").latest?.status, "kan_ikke_beregnes");
});

test("runway i dag bliver aldrig negativ", () => {
  const report = computeFinancialMetrics(
    [statement("2023-12-31", { net_result: -1_200_000, cash: 300_000 })],
    "2025-06-30",
  );
  const runway = metric(report, "runway_today").latest!;
  assert.equal(runway.value, 0);
  assert.match(runway.note ?? "", /brugt op/);
});

test("CAGR sammenligner ikke et kort første regnskabsår", () => {
  const report = computeFinancialMetrics(
    [
      period("2020-08-01", "2020-12-31", { gross_profit: 500_000 }),
      period("2021-01-01", "2021-12-31", { gross_profit: 1_200_000 }),
      period("2022-01-01", "2022-12-31", { gross_profit: 1_200_000 }),
      period("2023-01-01", "2023-12-31", { gross_profit: 1_200_000 }),
    ],
    "2024-06-30",
  );
  const cagr = metric(report, "gross_profit_cagr_3y").latest!;
  assert.equal(cagr.status, "kan_ikke_beregnes");
  assert.match(cagr.note ?? "", /ikke 12 måneder/);
});

test("negativ kapitaltilførsel forklares som udbytte eller nedsættelse", () => {
  const report = computeFinancialMetrics(
    [
      statement("2023-12-31", { equity: 2_000_000, net_result: 300_000 }),
      statement("2024-12-31", { equity: 1_500_000, net_result: 400_000 }),
    ],
    "2025-06-30",
  );
  const injection = metric(report, "capital_injection").latest!;
  assert.equal(injection.value, -900_000);
  assert.match(injection.note ?? "", /udbytte/);
});

test("T-820: det kompakte udtræk har enheden amount og valutaen, også for et norsk regnskab", () => {
  const danish = compactFinancialMetrics(profitable);
  assert.equal(danish.currency, "DKK");
  assert.equal(danish.currencyNote, undefined);
  assert.ok(danish.metrics.some((item) => item.unit === "amount"));
  assert.ok(danish.metrics.every((item) => (item.unit as string) !== "dkk"));

  const norwegian = compactFinancialMetrics(
    computeFinancialMetrics(
      [statement("2024-12-31", { revenue: 1_000_000, net_result: 50_000, equity: 300_000 })],
      "2025-06-30",
      { currency: "NOK", registryCountry: "NO" },
    ),
  );
  assert.equal(norwegian.currency, "NOK");
  assert.match(norwegian.currencyNote ?? "", /NOK/);
  assert.ok(norwegian.metrics.some((item) => item.unit === "amount"));
  assert.ok(norwegian.metrics.every((item) => (item.unit as string) !== "dkk"));
});
