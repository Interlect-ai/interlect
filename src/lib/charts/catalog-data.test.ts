import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityCalendar,
  activitySeries,
  countryCounts,
  cumulativeActivity,
  funnelData,
  intakeSeries,
  liveActivity,
  medianScore,
  sankeyData,
  scoreBins,
  scoreConfidencePoints,
  scoreRanges,
  sectorStageTree,
  specialistAverages,
  stageSlices,
  thresholdShare,
  type CatalogCase,
  type CatalogSnapshot,
} from "./catalog-data.ts";

const EMPTY: CatalogSnapshot = {
  threshold: 70,
  funnel: { steps: [] },
  geo: { rows: [] },
  intake: { bars: [] },
  scores: { bins: [], count: 0, overThreshold: 0, median: null },
  stages: [],
  activityByDay: [],
};

const FULL: CatalogSnapshot = {
  threshold: 70,
  funnel: {
    steps: [
      { key: "in", label: "Nye", count: 12 },
      { key: "screened", label: "Screenet", count: 9 },
      { key: "over", label: "Over tærsklen", count: 1 },
      { key: "deep", label: "Dyb analyse", count: 3 },
      { key: "committee", label: "Komité", count: 3 },
    ],
  },
  geo: {
    rows: [
      { code: "dk", total: 7 },
      { code: "NO", total: 0 },
      { code: "??", total: 4 },
    ],
  },
  intake: {
    bars: [
      { fromDaysAgo: 0, toDaysAgo: 6, total: 4, forwarded: 9 },
      { fromDaysAgo: 7, toDaysAgo: 13, total: 0, forwarded: 0 },
    ],
  },
  scores: {
    bins: [
      { label: "<50", count: 2 },
      { label: "50", count: -1 },
    ],
    count: 9,
    overThreshold: 12,
    median: 64.5,
  },
  stages: [
    { key: "seed", label: "Seed", count: 4 },
    { key: "series_a", label: "Serie A", count: 0 },
  ],
  activityByDay: [
    { day: "2026-10-13", count: 2 },
    { day: "2026-10-05", count: 1 },
    { day: "2026-10-14", count: 0 },
    { day: "ikke-en-dato", count: 5 },
  ],
};

function caseOf(over: Partial<CatalogCase>): CatalogCase {
  return {
    id: "c",
    companyName: "Selskab",
    stage: "seed",
    sector: "Software",
    lastActionAt: "2026-10-10T10:00:00Z",
    fitScore: 70,
    fitHistory: [60, 70],
    evidenceConfidence: 0.8,
    screeningConfidence: null,
    deepScores: [],
    ...over,
  };
}

test("every builder gives null (empty state) for a team without data", () => {
  for (const build of [
    funnelData,
    sankeyData,
    countryCounts,
    scoreBins,
    stageSlices,
    thresholdShare,
    medianScore,
    activitySeries,
    cumulativeActivity,
    liveActivity,
    activityCalendar,
  ]) {
    assert.equal(build(EMPTY), null, build.name);
  }
  assert.equal(intakeSeries(EMPTY, new Date()), null);
  for (const build of [scoreConfidencePoints, scoreRanges, specialistAverages, sectorStageTree]) {
    assert.equal(build([]), null, build.name);
  }
});

test("funnel and sankey: counts are kept, the cases that stop get their own flow, 0 flows are left out", () => {
  assert.deepEqual(
    funnelData(FULL)?.map((step) => step.value),
    [12, 9, 1, 3, 3],
  );
  const sankey = sankeyData(FULL)!;
  const flows = sankey.links.map((link) => [
    sankey.nodes[link.source]!.name,
    sankey.nodes[link.target]!.name,
    link.value,
  ]);
  assert.deepEqual(flows, [
    ["Nye", "Screenet", 9],
    ["Nye", "Stoppet ved nye", 3],
    ["Screenet", "Dyb analyse", 3],
    ["Screenet", "Stoppet ved screenet", 6],
    ["Dyb analyse", "Komité", 3],
  ]);
  // What flows out of a step never exceeds what came in.
  for (const [index, node] of sankey.nodes.entries()) {
    const inflow = sankey.links.filter((l) => l.target === index).reduce((s, l) => s + l.value, 0);
    const outflow = sankey.links.filter((l) => l.source === index).reduce((s, l) => s + l.value, 0);
    if (inflow > 0 && outflow > 0) assert.ok(outflow <= inflow, node.name);
  }
});

test("a deep analysis does not require 'over the threshold': it is no step in the flows", () => {
  const sankey = sankeyData(FULL)!;
  assert.ok(sankey.nodes.every((node) => node.name !== "Over tærsklen"));
  const intoDeep = sankey.links
    .filter((link) => sankey.nodes[link.target]!.name === "Dyb analyse")
    .reduce((sum, link) => sum + link.value, 0);
  assert.equal(intoDeep, 3);
});

test("a later step larger than the one before is capped, never a negative flow", () => {
  const odd = {
    ...FULL,
    funnel: {
      steps: [
        { key: "in", label: "A", count: 2 },
        { key: "screened", label: "B", count: 5 },
      ],
    },
  };
  const sankey = sankeyData(odd)!;
  assert.deepEqual(sankey.links, [{ source: 0, target: 1, value: 2 }]);
});

test("countries: upper case ISO codes, 0 and invalid codes left out", () => {
  assert.deepEqual(countryCounts(FULL), [{ code: "DK", value: 7 }]);
});

test("counts are never negative; the share over the threshold never passes 100 %", () => {
  assert.deepEqual(
    scoreBins(FULL)?.map((bin) => bin.count),
    [2, 0],
  );
  assert.deepEqual(thresholdShare(FULL), { over: 9, total: 9, percent: 100 });
  assert.deepEqual(stageSlices(FULL), [{ label: "Seed", value: 4 }]);
});

test("intake: forwarded never above the total, oldest period first", () => {
  const rows = intakeSeries(FULL, new Date("2026-10-14T12:00:00Z"))!;
  assert.deepEqual(
    rows.map((row) => [row.date.toISOString().slice(0, 10), row.total, row.forwarded]),
    [
      ["2026-10-01", 0, 0],
      ["2026-10-08", 4, 4],
    ],
  );
});

test("gauge: the median is clamped to 0–100; no median is the empty state", () => {
  assert.deepEqual(medianScore(FULL), { value: 64.5, threshold: 70 });
  assert.deepEqual(medianScore({ ...FULL, scores: { ...FULL.scores, median: 250 } })?.value, 100);
});

test("activity: invalid days are skipped, days in order, running total and live value", () => {
  assert.deepEqual(
    activitySeries(FULL)?.map((row) => row.runs),
    [1, 2, 0],
  );
  assert.deepEqual(
    cumulativeActivity(FULL)?.map((row) => row.total),
    [1, 3, 3],
  );
  assert.equal(liveActivity(FULL)?.value, 0);
  // A single day is not a line.
  assert.equal(activitySeries({ ...FULL, activityByDay: [{ day: "2026-10-13", count: 4 }] }), null);
});

test("calendar heatmap: one column per week, weekdays Monday first", () => {
  const columns = activityCalendar(FULL)!;
  // 5 Oct 2026 is a Monday; 13 and 14 Oct are the Tuesday and Wednesday of the next week.
  assert.deepEqual(
    columns.map((column) => [column.bin, column.bins.map((bin) => [bin.bin, bin.count])]),
    [
      [0, [[0, 1]]],
      [
        1,
        [
          [1, 2],
          [2, 0],
        ],
      ],
    ],
  );
});

test("scatter: cases without a score are left out, confidence as 0–100, missing confidence stays null", () => {
  const points = scoreConfidencePoints([
    caseOf({ id: "a", fitScore: 81, evidenceConfidence: 0.42 }),
    caseOf({ id: "b", fitScore: null }),
    caseOf({ id: "c", fitScore: 55, evidenceConfidence: null, screeningConfidence: null }),
    caseOf({ id: "d", lastActionAt: "ikke en dato" }),
  ])!;
  assert.deepEqual(
    points.map((point) => [point.score, point.confidence]),
    [
      [81, 42],
      [55, null],
    ],
  );
});

test("candlestick: first, lowest, highest and latest score; a case with one run has no movement and is left out", () => {
  const candles = scoreRanges([
    caseOf({ fitHistory: [62, 48, 90, 71] }),
    caseOf({ fitHistory: [55], lastActionAt: "2026-10-01T00:00:00Z" }),
    caseOf({ fitHistory: [] }),
  ])!;
  assert.deepEqual(
    candles.map((c) => [c.open, c.low, c.high, c.close]),
    [[62, 48, 90, 71]],
  );
});

test("radar: averages per criterion over the deep analyses, most common first, needs three axes", () => {
  const cases = [
    caseOf({
      deepScores: [
        { label: "Team", score: 80 },
        { label: "Marked", score: 60 },
        { label: "Teknologi", score: null },
      ],
    }),
    caseOf({
      deepScores: [
        { label: "Team", score: 70 },
        { label: "Teknologi", score: 75 },
        { label: "Deal", score: 1000 },
      ],
    }),
  ];
  assert.deepEqual(specialistAverages(cases), [
    { label: "Team", value: 75, cases: 2 },
    { label: "Deal", value: 100, cases: 1 },
    { label: "Marked", value: 60, cases: 1 },
    { label: "Teknologi", value: 75, cases: 1 },
  ]);
  assert.equal(specialistAverages([caseOf({ deepScores: [{ label: "Team", score: 80 }] })]), null);
});

test("many points: 500 cases stay sorted and complete; very large counts are kept", () => {
  const many = Array.from({ length: 500 }, (_, index) =>
    caseOf({
      id: String(index),
      lastActionAt: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
    }),
  );
  const points = scoreConfidencePoints(many)!;
  assert.equal(points.length, 500);
  assert.ok(points.every((point, i) => i === 0 || point.date >= points[i - 1]!.date));
  const huge = funnelData({
    ...FULL,
    funnel: { steps: [{ key: "a", label: "A", count: 2_000_000_000 }] },
  });
  assert.equal(huge?.[0]?.value, 2_000_000_000);
});

test("sunburst: sectors with their stages, a missing sector named, largest sector first", () => {
  const tree = sectorStageTree([
    caseOf({ sector: "Fintech", stage: "seed" }),
    caseOf({ sector: "Fintech", stage: "series_a" }),
    caseOf({ sector: null, stage: "seed" }),
  ])!;
  assert.deepEqual(tree, {
    name: "Cases",
    children: [
      {
        name: "Fintech",
        children: [
          { name: "Seed", value: 1 },
          { name: "Series A", value: 1 },
        ],
      },
      { name: "Ukendt sektor", children: [{ name: "Seed", value: 1 }] },
    ],
  });
});
