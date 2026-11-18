/**
 * The chart catalogue's data. Every bklit chart type is drawn with real numbers from
 * the active team: the Overblik snapshot (`getOverviewSnapshot`) and the case list
 * (`listCases`). Each builder is pure and returns null when there is nothing to draw, so the
 * chart shows its empty state instead of an empty frame or invented numbers. The builders cope
 * with zero, negative and very large values, a single point and many points (tested in
 * catalog-data.test.ts), because the same shapes feed the product's charts (c).
 */

import { stageLabel } from "../domain/labels.ts";

/** What the catalogue reads from the Overblik snapshot (a subset of `OverviewSnapshot`). */
export interface CatalogSnapshot {
  threshold: number;
  funnel: { steps: Array<{ key: string; label: string; count: number }> };
  geo: { rows: Array<{ code: string; total: number }> };
  intake: {
    bars: Array<{ fromDaysAgo: number; toDaysAgo: number; total: number; forwarded: number }>;
  };
  scores: {
    bins: Array<{ label: string; count: number }>;
    count: number;
    overThreshold: number;
    median: number | null;
  };
  stages: Array<{ key: string; label: string; count: number }>;
  activityByDay: Array<{ day: string; count: number }>;
}

/** What the catalogue reads from a case in `listCases`. */
export interface CatalogCase {
  id: string;
  companyName: string;
  stage: string;
  sector: string | null;
  lastActionAt: string;
  fitScore: number | null;
  fitHistory: number[];
  evidenceConfidence: number | null;
  screeningConfidence: number | null;
  deepScores: Array<{ label: string; score: number | null }>;
}

const finite = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A count is never negative or fractional in a chart of cases. */
const count = (value: number) => (finite(value) ? Math.max(0, Math.round(value)) : 0);

function dateOf(day: string): Date | null {
  const date = new Date(day.length === 10 ? `${day}T12:00:00Z` : day);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Funnel: how many of the cohort reached each step. */
export function funnelData(snapshot: CatalogSnapshot) {
  const steps = snapshot.funnel.steps.map((step) => ({
    label: step.label,
    value: count(step.count),
  }));
  return steps.length > 0 && steps[0]!.value > 0 ? steps : null;
}

/**
 * Sankey: the funnel as flows. "Over tærsklen" is a condition, not a step (a deep analysis does
 * not require it, funnel.ts `reachedSteps`), so it is left out of the chain: each step sends its
 * cases on to the next real step, and the rest stop there ("Stoppet ved …"). A later step larger
 * than the one before cannot be drawn as a flow and is capped (never a negative flow); flows of
 * 0 are left out (a sankey cannot draw them).
 */
export function sankeyData(snapshot: CatalogSnapshot) {
  const steps = snapshot.funnel.steps
    .filter((step) => step.key !== "over")
    .map((step) => ({ ...step, count: count(step.count) }));
  if (steps.length < 2 || steps[0]!.count === 0) return null;
  const nodes: Array<{ name: string; category?: "source" | "landing" | "outcome" }> = steps.map(
    (step, index) => ({
      name: step.label,
      category: index === 0 ? ("source" as const) : ("landing" as const),
    }),
  );
  const links: Array<{ source: number; target: number; value: number }> = [];
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    if (!next) return;
    const onward = Math.min(step.count, next.count);
    if (onward > 0) links.push({ source: index, target: index + 1, value: onward });
    const stopped = step.count - onward;
    if (stopped > 0) {
      nodes.push({ name: `Stoppet ved ${step.label.toLowerCase()}`, category: "outcome" });
      links.push({ source: index, target: nodes.length - 1, value: stopped });
    }
  });
  return links.length > 0 ? { nodes, links } : null;
}

/** Choropleth: cases per country (ISO 3166-1 alpha-2), countries without cases left out. */
export function countryCounts(snapshot: CatalogSnapshot) {
  const rows = snapshot.geo.rows
    .map((row) => ({ code: row.code.toUpperCase(), value: count(row.total) }))
    .filter((row) => /^[A-Z]{2}$/.test(row.code) && row.value > 0);
  return rows.length > 0 ? rows : null;
}

/** Bar: the score distribution of the screened cases. */
export function scoreBins(snapshot: CatalogSnapshot) {
  const bins = snapshot.scores.bins.map((bin) => ({ label: bin.label, count: count(bin.count) }));
  return bins.some((bin) => bin.count > 0) ? bins : null;
}

/** Composed: new cases per period (bars, dated at the period's first day) and how many went on (line). */
export function intakeSeries(snapshot: CatalogSnapshot, today: Date) {
  const rows = snapshot.intake.bars
    .map((bar) => ({
      date: new Date(
        today.getTime() - Math.max(count(bar.fromDaysAgo), count(bar.toDaysAgo)) * 86_400_000,
      ),
      total: count(bar.total),
      forwarded: Math.min(count(bar.forwarded), count(bar.total)),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows.some((row) => row.total > 0) ? rows : null;
}

/** Pie: active cases per company stage. */
export function stageSlices(snapshot: CatalogSnapshot) {
  const slices = snapshot.stages
    .map((stage) => ({ label: stage.label, value: count(stage.count) }))
    .filter((slice) => slice.value > 0);
  return slices.length > 0 ? slices : null;
}

/** Ring: the share of screened cases over the team's threshold. */
export function thresholdShare(snapshot: CatalogSnapshot) {
  const total = count(snapshot.scores.count);
  if (total === 0) return null;
  const over = Math.min(count(snapshot.scores.overThreshold), total);
  return { over, total, percent: Math.round((over / total) * 100) };
}

/** Gauge: the median screening score (0–100) against the threshold. */
export function medianScore(snapshot: CatalogSnapshot) {
  const median = snapshot.scores.median;
  if (!finite(median)) return null;
  return {
    value: Math.min(100, Math.max(0, median)),
    threshold: Math.min(100, Math.max(0, snapshot.threshold)),
  };
}

/** Line: analyses run per day (the last 14 days). */
export function activitySeries(snapshot: CatalogSnapshot) {
  const rows = snapshot.activityByDay
    .map((row) => ({ date: dateOf(row.day), runs: count(row.count) }))
    .filter((row): row is { date: Date; runs: number } => row.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return rows.length >= 2 && rows.some((row) => row.runs > 0) ? rows : null;
}

/** Area: the same days as a running total (analyses so far in the period). */
export function cumulativeActivity(snapshot: CatalogSnapshot) {
  const rows = activitySeries(snapshot);
  if (!rows) return null;
  let total = 0;
  return rows.map((row) => ({ date: row.date, total: (total += row.runs) }));
}

/** Live line: the activity as time points, the newest value as the live value. */
export function liveActivity(snapshot: CatalogSnapshot) {
  const rows = activitySeries(snapshot);
  if (!rows) return null;
  const data = rows.map((row) => ({ time: row.date.getTime() / 1000, value: row.runs }));
  return { data, value: data[data.length - 1]!.value };
}

/**
 * Heatmap: the same 14 days as a calendar, one column per week and one row per weekday
 * (Monday first), the count being the analyses run that day.
 */
export function activityCalendar(snapshot: CatalogSnapshot) {
  const rows = snapshot.activityByDay
    .map((row) => ({ date: dateOf(row.day), count: count(row.count) }))
    .filter((row): row is { date: Date; count: number } => row.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (rows.length === 0 || rows.every((row) => row.count === 0)) return null;
  const weekday = (date: Date) => (date.getUTCDay() + 6) % 7;
  const first = rows[0]!.date.getTime() - weekday(rows[0]!.date) * 86_400_000;
  const columns = new Map<number, Array<{ bin: number; count: number; date: Date }>>();
  for (const row of rows) {
    const week = Math.floor((row.date.getTime() - first) / (7 * 86_400_000));
    const bins = columns.get(week) ?? [];
    bins.push({ bin: weekday(row.date), count: row.count, date: row.date });
    columns.set(week, bins);
  }
  return [...columns.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, bins]) => ({ bin: week, bins: bins.sort((a, b) => a.bin - b.bin) }));
}

/** Scatter: each scored case at its latest activity, its score and its data confidence (0–100). */
export function scoreConfidencePoints(cases: readonly CatalogCase[]) {
  const points = cases
    .map((item) => {
      const date = dateOf(item.lastActionAt);
      const confidence = item.evidenceConfidence ?? item.screeningConfidence;
      if (!date || !finite(item.fitScore)) return null;
      return {
        date,
        name: item.companyName,
        score: Math.min(100, Math.max(0, item.fitScore)),
        confidence: finite(confidence)
          ? Math.round(Math.min(1, Math.max(0, confidence)) * 100)
          : null,
      };
    })
    .filter((point): point is NonNullable<typeof point> => point !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return points.length > 0 ? points : null;
}

/**
 * Candlestick: each case's scores across its runs: the first ("open"), the lowest, the highest
 * and the latest ("close"), placed at the case's latest activity.
 */
export function scoreRanges(cases: readonly CatalogCase[]) {
  const candles = cases
    .map((item) => {
      const date = dateOf(item.lastActionAt);
      const history = item.fitHistory.filter(finite);
      // A case with one run has no movement to show.
      if (!date || history.length < 2) return null;
      return {
        date,
        name: item.companyName,
        open: history[0]!,
        close: history[history.length - 1]!,
        high: Math.max(...history),
        low: Math.min(...history),
      };
    })
    .filter((candle): candle is NonNullable<typeof candle> => candle !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  return candles.length > 0 ? candles : null;
}

/**
 * Radar: the deep analyses' specialist scores, averaged per criterion over the cases that have
 * one (the most common criteria, at most eight). A radar needs three axes.
 */
export function specialistAverages(cases: readonly CatalogCase[], max = 8) {
  const sums = new Map<string, { total: number; n: number }>();
  for (const item of cases) {
    for (const row of item.deepScores) {
      if (!finite(row.score) || !row.label) continue;
      const entry = sums.get(row.label) ?? { total: 0, n: 0 };
      entry.total += Math.min(100, Math.max(0, row.score));
      entry.n += 1;
      sums.set(row.label, entry);
    }
  }
  const axes = [...sums.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([label, { total, n }]) => ({ label, value: Math.round(total / n), cases: n }));
  return axes.length >= 3 ? axes : null;
}

/** Sunburst: the cases by sector and, inside each sector, by company stage. */
export function sectorStageTree(cases: readonly CatalogCase[], unknownSector = "Ukendt sektor") {
  const sectors = new Map<string, Map<string, number>>();
  for (const item of cases) {
    const sector = item.sector?.trim() || unknownSector;
    const key = item.stage?.trim() ?? "";
    const stage = (stageLabel as Record<string, string>)[key] ?? (key || "?");
    const stages = sectors.get(sector) ?? new Map<string, number>();
    stages.set(stage, (stages.get(stage) ?? 0) + 1);
    sectors.set(sector, stages);
  }
  if (sectors.size === 0) return null;
  return {
    name: "Cases",
    children: [...sectors.entries()]
      .sort((a, b) => sum(b[1]) - sum(a[1]))
      .map(([name, stages]) => ({
        name,
        children: [...stages.entries()].map(([stage, value]) => ({ name: stage, value })),
      })),
  };
}

function sum(map: Map<string, number>) {
  let total = 0;
  for (const value of map.values()) total += value;
  return total;
}
