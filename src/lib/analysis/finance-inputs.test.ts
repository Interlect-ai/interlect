import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateFinance } from "./finance.ts";
import { financeInputsFor, type FinancePointRow } from "./finance-inputs.ts";

const row = (
  id: string,
  metric: string,
  value: number,
  periodEnd: string,
  sourceType: string,
): FinancePointRow => ({
  id,
  metric,
  value,
  unit: "DKK",
  period_start: `${periodEnd.slice(0, 4)}-01-01`,
  period_end: periodEnd,
  evidence_items: { sources: { source_type: sourceType } },
});

const registry = [
  row("r23", "annual_revenue", 1000, "2023-12-31", "registry_regnskab"),
  row("r24", "annual_revenue", 1200, "2024-12-31", "registry_regnskab"),
  row("c24", "cash", 4200, "2024-12-31", "registry_regnskab"),
  row("o24", "monthly_operating_expenses", 140, "2024-12-31", "registry_regnskab"),
];

const metric = (inputs: ReturnType<typeof calculateFinance>, key: string) =>
  inputs.find((item) => item.metric === key)!;

test("growth, burn and runway come from the register when the specialist gave nothing", () => {
  const results = calculateFinance(financeInputsFor(registry, new Set()), "da");
  assert.equal(metric(results, "revenue_growth").value, 20);
  assert.equal(metric(results, "net_burn").value, 40);
  assert.equal(metric(results, "runway").value, 105);
  assert.deepEqual(metric(results, "revenue_growth").inputIds, ["r23", "r24"]);
});

test("the specialist's own figure wins over the register's and is marked as reported", () => {
  const rows = [...registry, row("s1", "cash", 500, "2024-12-31", "web_search")];
  const results = calculateFinance(financeInputsFor(rows, new Set(["s1"])), "da");
  const runway = metric(results, "runway");
  assert.equal(runway.value, 12.5);
  assert.ok(runway.warnings.some((warning) => warning.includes("oplyst")));
  assert.ok(runway.warnings.some((warning) => warning.includes("estimat")));
});

test("a result from the register says so, and says when it is an estimate", () => {
  const results = calculateFinance(financeInputsFor(registry, new Set()), "da");
  assert.ok(metric(results, "net_burn").warnings.some((warning) => warning.includes("estimat")));
  assert.ok(
    metric(results, "revenue_growth").warnings.some((warning) => warning.includes("registrets")),
  );
  assert.ok(
    !metric(results, "revenue_growth").warnings.some((warning) => warning.includes("estimat")),
  );
});

test("growth needs two full years about a year apart and a positive first year", () => {
  const one = calculateFinance(financeInputsFor([registry[1]!], new Set()), "da");
  assert.equal(metric(one, "revenue_growth").status, "kan_ikke_beregnes");
  assert.deepEqual(metric(one, "revenue_growth").missingInputs, ["annual_revenue"]);
  const zero = calculateFinance(
    financeInputsFor(
      [row("a", "annual_revenue", 0, "2023-12-31", "registry_regnskab"), registry[1]!],
      new Set(),
    ),
    "da",
  );
  assert.equal(metric(zero, "revenue_growth").status, "kan_ikke_beregnes");
  const gap = calculateFinance(
    financeInputsFor(
      [row("a", "annual_revenue", 500, "2021-12-31", "registry_regnskab"), registry[1]!],
      new Set(),
    ),
    "da",
  );
  assert.equal(metric(gap, "revenue_growth").status, "kan_ikke_beregnes");
});

test("a profitable company has no meaningful burn or runway", () => {
  const rows = registry.map((r) => (r.id === "o24" ? { ...r, value: 60 } : r));
  const results = calculateFinance(financeInputsFor(rows, new Set()), "da");
  assert.equal(metric(results, "runway").status, "kan_ikke_beregnes");
  assert.ok(metric(results, "net_burn").warnings.length > 0);
});

test("without any figures nothing is invented", () => {
  assert.deepEqual(financeInputsFor([], new Set()), []);
});

test("the register does not fill in costs or revenue next to the specialist's own revenue", () => {
  const rows = [...registry, row("m1", "mrr", 150, "2024-12-31", "web_search")];
  const inputs = financeInputsFor(rows, new Set(["m1"]));
  assert.deepEqual(inputs.map((input) => input.metric).sort(), ["cash", "mrr"]);
  assert.equal(
    calculateFinance(inputs, "da").find((r) => r.metric === "net_burn")?.status,
    "kan_ikke_beregnes",
  );
});

test("register figures in another currency never void the specialist's results", () => {
  const usd = { ...row("s1", "arr", 1200, "2024-12-31", "web_search"), unit: "USD" };
  const inputs = financeInputsFor([...registry, usd], new Set(["s1"]));
  assert.deepEqual(
    inputs.map((input) => input.id),
    ["s1"],
  );
  assert.equal(calculateFinance(inputs, "da").find((r) => r.metric === "mrr")?.value, 100);
});

test("cash is taken from the same year as the costs", () => {
  const rows = [...registry, row("c23", "cash", 1, "2023-12-31", "registry_regnskab")];
  const inputs = financeInputsFor(rows, new Set());
  assert.equal(inputs.find((input) => input.metric === "cash")?.id, "c24");
});
