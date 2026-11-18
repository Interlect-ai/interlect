import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CASH_FRAME,
  REVENUE_FRAME,
  cashLayout,
  economyMiniLayout,
  marketSeries,
  revenueMarginLayout,
} from "./layouts.ts";

const DAY = 1000 * 60 * 60 * 24;
const YEAR = 365 * DAY;

function assertInside(value: number, low: number, high: number, what: string) {
  assert.ok(Number.isFinite(value), `${what} is not a number: ${value}`);
  assert.ok(value >= low - 1e-6 && value <= high + 1e-6, `${what} ${value} outside ${low}–${high}`);
}

/** Every bar and margin dot stays inside the plot, whatever the figures are. */
function assertRevenueInside(layout: ReturnType<typeof revenueMarginLayout>) {
  const { left, right, top, base } = REVENUE_FRAME;
  for (const bar of layout.bars) {
    if (!bar) continue;
    assertInside(bar.x, left, right, "bar x");
    assertInside(bar.y, top, base, "bar top");
    assertInside(bar.y + bar.height, top, base + 2, "bar bottom");
  }
  for (const point of layout.marginPoints) assertInside(point.y, top, base, "margin dot");
}

test("Økonomi bars: the tallest year reaches the top, the bars stand on zero", () => {
  const layout = revenueMarginLayout([10e6, 20e6, 40e6], [30, 35, 40]);
  assertRevenueInside(layout);
  const [a, b, c] = layout.bars;
  assert.equal(c!.y, REVENUE_FRAME.top);
  assert.equal(layout.zero, REVENUE_FRAME.base);
  // Heights are proportional to the figures (20 → 40 doubles the bar).
  assert.ok(Math.abs(c!.height / b!.height - 2) < 1e-9);
  assert.ok(Math.abs(b!.height / a!.height - 2) < 1e-9);
  // The grid's labels are the real values at the lines.
  assert.deepEqual(
    layout.grid.map((line) => line.value),
    [0, 20e6, 40e6],
  );
});

test("Økonomi bars: a missing year has no bar and no margin dot, a zero year a 2 px stub", () => {
  const layout = revenueMarginLayout([5e6, null, 0], [20, null, 10]);
  assert.equal(layout.bars[1], null);
  assert.equal(layout.bars[2]!.height, 2);
  assert.deepEqual(
    layout.marginPoints.map((point) => point.index),
    [0, 2],
  );
  assert.match(layout.marginPath, /^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
});

test("Økonomi bars: a negative year hangs below the zero line, inside the frame", () => {
  const layout = revenueMarginLayout([-3e6, 6e6], [-12, 25]);
  assertRevenueInside(layout);
  const [loss, profit] = layout.bars;
  assert.equal(loss!.y, layout.zero, "the negative bar starts at zero and goes down");
  assert.ok(profit!.y + profit!.height <= layout.zero + 1e-9);
  assert.ok(Math.abs(profit!.height / loss!.height - 2) < 1e-9);
  assert.ok(layout.grid[0]!.value < 0, "the lowest grid line shows the negative value");
});

test("Økonomi bars: one year, only losses, huge figures and many years stay inside", () => {
  assertRevenueInside(revenueMarginLayout([7e6], [null]));
  assertRevenueInside(revenueMarginLayout([-1e6, -4e6], [-50, -80]));
  assertRevenueInside(revenueMarginLayout([2e12, 9e11], [60, 61]));
  const many = revenueMarginLayout(
    Array.from({ length: 12 }, (_, i) => (i - 3) * 1e6),
    Array.from({ length: 12 }, (_, i) => i * 3 - 10),
  );
  assertRevenueInside(many);
  const xs = many.bars.map((bar) => bar!.x);
  assert.deepEqual(
    xs,
    [...xs].sort((a, b) => a - b),
    "the years are in order",
  );
  for (let i = 1; i < many.bars.length; i++) {
    assert.ok(many.bars[i]!.x >= many.bars[i - 1]!.x + many.bars[i - 1]!.width, "no overlap");
  }
});

test("Økonomi bars: no figures at all gives no bars and no NaN", () => {
  const layout = revenueMarginLayout([null, null], [null, null]);
  assert.deepEqual(layout.bars, [null, null]);
  assert.equal(layout.marginPath, "");
  for (const line of layout.grid) assert.ok(Number.isFinite(line.value));
});

function assertCashInside(layout: NonNullable<ReturnType<typeof cashLayout>>) {
  const { left, right, floor, ceiling } = CASH_FRAME;
  assertInside(layout.zero, ceiling, floor, "zero line");
  for (const dot of layout.dots) {
    assertInside(dot.x, left, right, "dot x");
    assertInside(dot.y, ceiling, floor, "dot y");
  }
  assert.doesNotMatch(layout.line + layout.area, /NaN|Infinity/);
}

test("likviditet: the highest balance reaches the top, zero is the floor", () => {
  const start = Date.UTC(2022, 11, 31);
  const layout = cashLayout(
    [
      { time: start, cash: 4e6 },
      { time: start + YEAR, cash: 8e6 },
    ],
    null,
    0,
  )!;
  assertCashInside(layout);
  assert.equal(layout.dots[1]!.y, CASH_FRAME.ceiling);
  assert.equal(layout.zero, CASH_FRAME.floor);
  assert.equal(layout.projection, null);
  assert.equal(layout.now, null, "today outside the range is not marked");
});

test("likviditet: an overdraft is drawn below the zero line, never outside the frame", () => {
  const start = Date.UTC(2022, 11, 31);
  const layout = cashLayout(
    [
      { time: start, cash: 2e6 },
      { time: start + YEAR, cash: -1e6 },
    ],
    null,
    0,
  )!;
  assertCashInside(layout);
  assert.ok(layout.dots[1]!.y > layout.zero, "the negative balance is below zero");
  assert.ok(layout.zero < CASH_FRAME.floor, "zero moves up to make room for the overdraft");
  assert.match(layout.area, new RegExp(`${layout.zero.toFixed(1)} Z$`), "the area closes at zero");
});

test("likviditet: the runway projection ends at zero at the month the money runs out", () => {
  const start = Date.UTC(2023, 11, 31);
  const end = start + 18 * 30 * DAY;
  const now = start + 60 * DAY;
  const layout = cashLayout([{ time: start, cash: 3e6 }], end, now)!;
  assertCashInside(layout);
  assert.equal(layout.t1, end);
  assert.equal(layout.projection!.x, CASH_FRAME.right);
  assert.match(
    layout.projection!.path,
    new RegExp(`L${CASH_FRAME.right.toFixed(1)},${layout.zero.toFixed(1)}$`),
  );
  assert.ok(layout.now! > CASH_FRAME.left && layout.now! < CASH_FRAME.right);
});

test("likviditet: no balances, no chart; many balances stay in order", () => {
  assert.equal(cashLayout([], null, 0), null);
  const start = Date.UTC(2015, 11, 31);
  const layout = cashLayout(
    Array.from({ length: 10 }, (_, i) => ({ time: start + i * YEAR, cash: (i % 3) * 5e9 })),
    null,
    0,
  )!;
  assertCashInside(layout);
  const xs = layout.dots.map((dot) => dot.x);
  assert.deepEqual(
    xs,
    [...xs].sort((a, b) => a - b),
  );
});

test("Økonomi-kort: shares add up to the plot, a negative year hangs below the zero line", () => {
  const { bars, baseline, hasNegative } = economyMiniLayout([-2e6, 6e6, null]);
  assert.equal(hasNegative, true);
  assert.equal(baseline, 0.25);
  assert.equal(bars[2], null);
  assert.deepEqual(bars[0], { size: 0.25, bottom: 0, isNegative: true });
  assert.deepEqual(bars[1], { size: 0.75, bottom: 0.25, isNegative: false });
  for (const bar of bars) if (bar) assert.ok(bar.bottom >= 0 && bar.bottom + bar.size <= 1 + 1e-9);
});

test("Økonomi-kort: zero years, one year and all missing", () => {
  const zero = economyMiniLayout([0, 0]);
  assert.equal(zero.hasNegative, false);
  assert.ok(
    zero.bars.every((bar) => bar!.size === 0.02),
    "zero is a thin stub, not empty",
  );
  assert.deepEqual(economyMiniLayout([5e6]).bars, [{ size: 1, bottom: 0, isNegative: false }]);
  assert.deepEqual(economyMiniLayout([null, null]).bars, [null, null]);
});

test("markedet: the years in time order, the dashed forecast from the last actual year", () => {
  const series = marketSeries([
    { year: 2026, value: 8.2, basis: "forecast" },
    { year: 2023, value: 4.9, basis: "actual" },
    { year: 2024, value: 5.8, basis: "actual" },
    { year: 2025, value: 6.9, basis: "forecast" },
  ]);
  assert.deepEqual(
    series.rows.map((row) => [row.date.getUTCFullYear(), row.value]),
    [
      [2023, 4.9],
      [2024, 5.8],
      [2025, 6.9],
      [2026, 8.2],
    ],
  );
  assert.equal(series.dashFromIndex, 1);
  assert.equal(series.last?.year, 2026);
  assert.equal(series.last?.basis, "forecast");
});

test("markedet: no points, one point, only actual, only forecast, zeros and huge values", () => {
  assert.deepEqual(marketSeries([]), { points: [], rows: [], dashFromIndex: null, last: null });
  const one = marketSeries([{ year: 2025, value: 5e8, basis: "forecast" }]);
  assert.equal(one.rows.length, 1);
  assert.equal(one.dashFromIndex, null);
  assert.equal(
    marketSeries([
      { year: 2023, value: 0, basis: "actual" },
      { year: 2024, value: 0, basis: "actual" },
    ]).dashFromIndex,
    null,
  );
  assert.equal(
    marketSeries([
      { year: 2027, value: 3e15, basis: "forecast" },
      { year: 2026, value: 1e15, basis: "forecast" },
    ]).dashFromIndex,
    0,
  );
  const many = marketSeries(
    Array.from({ length: 30 }, (_, i) => ({
      year: 2000 + i,
      value: i * 1e7,
      basis: i < 20 ? ("actual" as const) : ("forecast" as const),
    })),
  );
  assert.equal(many.rows.length, 30);
  assert.equal(many.dashFromIndex, 19);
  assert.ok(many.rows.every((row) => Number.isFinite(row.date.getTime())));
});

test("markedet: one point per year, the actual figure wins over a forecast for the same year", () => {
  const series = marketSeries([
    { year: 2025, value: 7, basis: "forecast" },
    { year: 2024, value: 5, basis: "actual" },
    { year: 2025, value: 6.5, basis: "actual" },
  ]);
  assert.deepEqual(
    series.points.map((point) => [point.year, point.value, point.basis]),
    [
      [2024, 5, "actual"],
      [2025, 6.5, "actual"],
    ],
  );
  assert.equal(series.dashFromIndex, null);
});
