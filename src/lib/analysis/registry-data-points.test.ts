import assert from "node:assert/strict";
import { test } from "node:test";
import { registryDataPoints } from "./registry-data-points.ts";

const claimOf = (metric: string, value: number) => `${metric}:${value}`;

test("revenue and cash become data points, nothing else", () => {
  const points = registryDataPoints(
    [
      {
        periodStart: "2024-01-01",
        periodEnd: "2024-12-31",
        facts: [
          { metric: "revenue", value: 504, unit: "DKK" },
          { metric: "cash", value: 12, unit: "DKK" },
          { metric: "equity", value: 99, unit: "DKK" },
        ],
      },
    ],
    claimOf,
  );
  assert.deepEqual(
    points.map((point) => [point.metric, point.value, point.claim]),
    [
      ["annual_revenue", 504, "revenue:504"],
      ["cash", 12, "cash:12"],
    ],
  );
});

test("a short first year gives no annual revenue, but still a closing cash balance", () => {
  const points = registryDataPoints(
    [
      {
        periodStart: "2024-09-01",
        periodEnd: "2024-12-31",
        facts: [
          { metric: "revenue", value: 10, unit: "DKK" },
          { metric: "cash", value: 5, unit: "DKK" },
        ],
      },
    ],
    claimOf,
  );
  assert.deepEqual(
    points.map((point) => point.metric),
    ["cash"],
  );
});

test("a leap year and a non-finite value are handled", () => {
  const points = registryDataPoints(
    [
      {
        periodStart: "2023-03-01",
        periodEnd: "2024-02-29",
        facts: [{ metric: "revenue", value: 7, unit: "NOK" }],
      },
      {
        periodStart: "2022-03-01",
        periodEnd: "2023-02-28",
        facts: [{ metric: "revenue", value: Number.NaN, unit: "NOK" }],
      },
    ],
    claimOf,
  );
  assert.equal(points.length, 1);
  assert.equal(points[0]!.unit, "NOK");
});

test("T-767: monthly operating costs are derived from revenue, result and depreciation", () => {
  const points = registryDataPoints(
    [
      {
        periodStart: "2024-01-01",
        periodEnd: "2024-12-31",
        facts: [
          { metric: "revenue", value: 1200, unit: "DKK" },
          { metric: "net_result", value: -600, unit: "DKK" },
          { metric: "depreciation", value: 120, unit: "DKK" },
        ],
      },
    ],
    claimOf,
  );
  const opex = points.find((point) => point.metric === "monthly_operating_expenses");
  // Burn for the year = -(-600 + 120) = 480; costs = 1200 + 480 = 1680; per month 140.
  assert.equal(opex?.value, 140);
  assert.equal(opex?.estimated, true);
  assert.equal(opex?.claim, "net_result:-600");
});

test("T-767: no derived costs without a full year, a net result or one currency", () => {
  const base = { periodStart: "2024-01-01", periodEnd: "2024-12-31" };
  const none = registryDataPoints(
    [
      { ...base, facts: [{ metric: "revenue", value: 10, unit: "DKK" }] },
      {
        periodStart: "2024-09-01",
        periodEnd: "2024-12-31",
        facts: [
          { metric: "revenue", value: 10, unit: "DKK" },
          { metric: "net_result", value: 1, unit: "DKK" },
        ],
      },
      {
        ...base,
        facts: [
          { metric: "revenue", value: 10, unit: "DKK" },
          { metric: "net_result", value: 1, unit: "EUR" },
        ],
      },
    ],
    claimOf,
  );
  assert.deepEqual(
    none.filter((point) => point.metric === "monthly_operating_expenses"),
    [],
  );
});
