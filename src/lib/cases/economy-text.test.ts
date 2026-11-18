import { test } from "node:test";
import assert from "node:assert/strict";
import { economyView } from "./deep-view.ts";
import { calculationValue, cashStory, revenueStory } from "./economy-text.ts";
import { missingDataMailto, unresolvedReason } from "./missing-data.ts";

const YEARS = ["2022-12-31", "2023-12-31", "2024-12-31"];

function metric(key: string, values: Array<number | null>) {
  const series = values.map((value, index) => ({
    periodEnd: YEARS[index]!,
    value,
    status: value === null ? ("kan_ikke_beregnes" as const) : ("ok" as const),
    inputs: [],
    note: null,
  }));
  return {
    key,
    label: key,
    category: "indtjening" as const,
    unit: "dkk" as const,
    formula: "f",
    series,
    latest: series[series.length - 1] ?? null,
  };
}

function report(metrics: ReturnType<typeof metric>[]) {
  return {
    version: "interlect-financial-metrics-v1" as const,
    asOf: "2026-09-30",
    years: YEARS,
    metrics,
  };
}

test("the revenue sentence states only what the figures show", () => {
  const view = economyView(
    report([
      metric("revenue", [3_100_000, 8_000_000, 14_200_000]),
      metric("gross_margin", [29, 35, 41]),
    ]),
  )!;
  const text = revenueStory(view);
  assert.match(text, /Omsætningen er gået fra 3,1 mio\. kr\. i 2022 til 14 mio\. kr\. i 2024\./);
  assert.match(text, /Bruttomarginen er steget fra 29 % i 2022 til 41 % i 2024\./);
});

test("one year, gross profit only and no margins give shorter sentences", () => {
  const one = economyView(report([metric("revenue", [null, null, 5_000_000])]))!;
  assert.equal(revenueStory(one), "Omsætningen var 5 mio. kr. i 2024.");
  const grossOnly = economyView(report([metric("gross_profit", [1_000_000, null, 2_000_000])]))!;
  assert.match(revenueStory(grossOnly), /^Bruttofortjenesten er gået fra 1 mio\. kr\. i 2022/);
  assert.equal(revenueStory({ ...grossOnly, revenueCard: null }), "");
});

test("the runway sentence prefers today, then the balance date, then the cash alone", () => {
  const today = economyView(
    report([
      metric("cash", [null, null, 8_500_000]),
      metric("runway_at_balance_date", [null, null, 12]),
      metric("runway_today", [null, null, 9]),
    ]),
  )!;
  assert.match(cashStory(today), /ca\. 9 mdr\. fra i dag/);
  assert.match(cashStory(today), /estimat/);
  const balance = economyView(
    report([
      metric("cash", [null, null, 8_500_000]),
      metric("runway_at_balance_date", [null, null, 12]),
    ]),
  )!;
  assert.match(cashStory(balance), /Ved seneste regnskab \(2024\) rakte pengene til ca\. 12 mdr\./);
  const cashOnly = economyView(report([metric("cash", [null, null, 2_000_000])]))!;
  assert.match(cashStory(cashOnly), /Likvider var 2 mio\. kr\./);
  assert.match(cashStory(cashOnly), /Runway kan ikke beregnes/);
});

test("calculation values keep the unit the code used", () => {
  assert.equal(calculationValue({ value: 4.236, unit: "x" }), "4,24 x");
  assert.equal(calculationValue({ value: 9, unit: null }), "9");
});

test("missing data: the reason and the mail draft", () => {
  assert.equal(
    unresolvedReason({ missingInputs: ["cogs", "customers"], warnings: [] }),
    "mangler vareforbrug (COGS), kunder",
  );
  assert.equal(
    unresolvedReason({ missingInputs: [], warnings: ["Runway er ikke meningsfuld."] }),
    "Runway er ikke meningsfuld.",
  );
  assert.equal(
    unresolvedReason({ missingInputs: [], warnings: [] }),
    "kan ikke beregnes af de angivne tal",
  );
  const mail = missingDataMailto("Acme", [
    { metric: "ltv", missingInputs: ["customers"], warnings: [] },
  ]);
  assert.match(mail, /^mailto:\?subject=/);
  assert.match(decodeURIComponent(mail), /- LTV: mangler kunder/);
});

test("a foreign registry's amounts say their currency, never kr. (T-851)", () => {
  const view = economyView({
    ...report([
      metric("revenue", [3_100_000, 8_000_000, 14_200_000]),
      metric("cash", [1, 2, 900_000]),
    ]),
    currency: "NOK",
  })!;
  assert.equal(view.currency, "NOK");
  assert.match(revenueStory(view), /fra 3,1 mio\. NOK i 2022 til 14 mio\. NOK i 2024/);
  assert.doesNotMatch(revenueStory(view), / kr\./);
  const danish = economyView(report([metric("revenue", [3_100_000, 8_000_000, 14_200_000])]))!;
  assert.equal(danish.currency, undefined);
  assert.match(revenueStory(danish), /14 mio\. kr\. i 2024/);
});
