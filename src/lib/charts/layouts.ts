/**
 * The geometry of the hand-made charts in Dyb analyse (c1 + e), as pure functions, so it is
 * tested with hard data (zero, negative figures, one year, missing years, very large figures,
 * many points) instead of only being looked at. The components draw exactly what these return.
 * The frames are the prototype's viewBoxes (Case Dyb analyse v5).
 */

export interface Bar {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Økonomi: revenue (or gross profit) bars in 560 × 240 with the gross margin line on top. */
export const REVENUE_FRAME = { left: 40, right: 540, top: 12, base: 220 } as const;

export function revenueMarginLayout(
  values: ReadonlyArray<number | null>,
  margins: ReadonlyArray<number | null>,
) {
  const { left, right, top, base } = REVENUE_FRAME;
  const present = values.filter(isNumber);
  const dmax = Math.max(1, ...present);
  const dmin = Math.min(0, ...present);
  const span = dmax - dmin || 1;
  const y = (value: number) => base - ((value - dmin) / span) * (base - top);
  const count = Math.max(1, values.length);
  const slot = (right - left) / count;
  const cx = values.map((_, index) => left + slot * index + slot / 2);
  const barWidth = Math.min(64, slot * 0.52);
  const zero = y(0);
  const bars: Array<Bar | null> = values.map((value, index) =>
    !isNumber(value)
      ? null
      : {
          x: cx[index]! - barWidth / 2,
          y: Math.min(y(value), zero),
          width: barWidth,
          // A zero year still shows a 2 px stub, so "0" is told apart from "not reported".
          height: Math.max(2, Math.abs(y(value) - zero)),
        },
  );
  const marginPresent = margins.filter(isNumber);
  const mmin = Math.min(0, ...marginPresent);
  const mmax = Math.max(1, ...marginPresent);
  const my = (value: number) =>
    base - 14 - ((value - mmin) / (mmax - mmin || 1)) * (base - top - 28);
  const marginPoints = margins.flatMap((value, index) =>
    value === null || index >= cx.length ? [] : [{ x: cx[index]!, y: my(value), index }],
  );
  const marginPath = marginPoints
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(" ");
  const grid = [0, 0.5, 1].map((fraction) => ({
    y: base - fraction * (base - top),
    value: dmin + fraction * span,
  }));
  return { slot, cx, bars, zero, marginPoints, marginPath, grid };
}

/** Økonomi: cash at each balance date in 360 × 220, with the runway projection to zero. */
export const CASH_FRAME = { left: 20, right: 350, floor: 190, ceiling: 40 } as const;

const QUARTER_MS = 1000 * 60 * 60 * 24 * 90;

export function cashLayout(
  points: ReadonlyArray<{ time: number; cash: number }>,
  endTime: number | null,
  now: number,
) {
  if (points.length === 0) return null;
  const { left, right, floor, ceiling } = CASH_FRAME;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const t0 = first.time;
  const t1 = Math.max(endTime ?? last.time, last.time + QUARTER_MS);
  // A negative balance (an overdraft) is drawn below the zero line, never outside the frame.
  const low = Math.min(0, ...points.map((point) => point.cash));
  const high = Math.max(1, ...points.map((point) => point.cash));
  const x = (time: number) => left + ((time - t0) / (t1 - t0 || 1)) * (right - left);
  const y = (cash: number) => floor - ((cash - low) / (high - low || 1)) * (floor - ceiling);
  const zero = y(0);
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${x(point.time).toFixed(1)},${y(point.cash).toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${x(last.time).toFixed(1)},${zero.toFixed(1)} L${x(first.time).toFixed(1)},${zero.toFixed(1)} Z`;
  const projection =
    endTime === null
      ? null
      : {
          path: `M${x(last.time).toFixed(1)},${y(last.cash).toFixed(1)} L${x(endTime).toFixed(1)},${zero.toFixed(1)}`,
          x: x(endTime),
        };
  const dots = points.map((point) => ({ x: x(point.time), y: y(point.cash) }));
  return {
    t0,
    t1,
    zero,
    line,
    area,
    dots,
    projection,
    now: now > t0 && now < t1 ? x(now) : null,
  };
}

/**
 * Konklusion's Økonomi card: one bar per year as a share of the plot's height. A negative year
 * hangs below the zero line (never mirrored upwards as if it were positive).
 */
export function economyMiniLayout(values: ReadonlyArray<number | null>) {
  const finite = values.filter(isNumber);
  const positive = Math.max(0, ...finite);
  const negative = Math.max(0, ...finite.map((value) => -value));
  const span = Math.max(1, positive + negative);
  /** The zero line, as a share of the plot from the bottom (0 when no year is negative). */
  const baseline = negative / span;
  const bars = values.map((value) => {
    if (value === null || !Number.isFinite(value)) return null;
    const size = Math.max(0.02, Math.abs(value) / span);
    const isNegative = value < 0;
    return { size, bottom: isNegative ? baseline - size : baseline, isNegative };
  });
  return { bars, baseline, hasNegative: negative > 0 };
}

/**
 * Produkt og marked (bklit area chart, c2): one row per year in time order, and where the
 * dashed forecast begins. The line is dashed from the last actual year into the first forecast
 * year (all of it when every year is a forecast); one point has no line to dash.
 */
export function marketSeries(
  points: ReadonlyArray<{ year: number; value: number; basis: "actual" | "forecast" }>,
) {
  // One point per year; when a source gives both, the actual figure wins over the forecast.
  const byYear = new Map<number, (typeof points)[number]>();
  for (const point of points) {
    if (!Number.isFinite(point.value) || !Number.isInteger(point.year)) continue;
    const seen = byYear.get(point.year);
    if (!seen || (seen.basis === "forecast" && point.basis === "actual"))
      byYear.set(point.year, point);
  }
  const sorted = [...byYear.values()].sort((a, b) => a.year - b.year);
  const rows = sorted.map((point) => ({
    date: new Date(Date.UTC(point.year, 0, 1)),
    value: point.value,
  }));
  const firstForecast = sorted.findIndex((point) => point.basis === "forecast");
  const dashFromIndex =
    sorted.length < 2 || firstForecast === -1 ? null : Math.max(0, firstForecast - 1);
  return { points: sorted, rows, dashFromIndex, last: sorted[sorted.length - 1] ?? null };
}

function isNumber(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}
