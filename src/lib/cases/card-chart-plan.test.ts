import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeepCardData } from "../analysis/card-data.ts";
import { specialistChartPlan, type ChartPlanGroup } from "./card-chart-plan.ts";

const EMPTY_SLOT = { status: "not_found", data: null, reason: null };

/** A run with card data where every slot came back empty with a reason (searched, nothing found). */
function searchedNothing(highlights: DeepCardData["highlights"] = {}): DeepCardData {
  const slot = { status: "not_found", data: null, reason: "Kilderne havde det ikke." };
  return {
    team: slot,
    market: slot,
    techBenchmarks: slot,
    ownership: slot,
    highlights,
  } as unknown as DeepCardData;
}

/** A run from before the card data: no slot has data or a reason. */
const BEFORE_CARD_DATA = {
  team: EMPTY_SLOT,
  market: EMPTY_SLOT,
  techBenchmarks: EMPTY_SLOT,
  ownership: EMPTY_SLOT,
  highlights: {},
} as unknown as DeepCardData;

function group(overrides: Partial<ChartPlanGroup> = {}): ChartPlanGroup {
  return {
    id: "people_team",
    score: 60,
    criteria: [{}, {}],
    categories: ["team"],
    strengths: [],
    weaknesses: [],
    unknowns: [],
    questions: [],
    ...overrides,
  };
}

const figures = (count: number) => ({
  kind: "highlights",
  items: Array.from({ length: count }, (_, index) => ({
    label: "Kunder",
    value: 10 + index,
    unit: "kunder",
    period: `${2021 + index}`,
    evidenceIds: [],
  })),
  notFound: null,
});

test("T-918: every scored specialist gets a chart, never 'Mangler information' alone", () => {
  const ids = [
    "people_team",
    "product_market_gtm",
    "technology_risk",
    "fund_finance_deal",
    "custom_regulatory",
  ];
  const runs: Array<DeepCardData | null> = [null, BEFORE_CARD_DATA, searchedNothing()];
  for (const id of ids) {
    for (const cardData of runs) {
      for (const criteria of [1, 2, 5]) {
        const plan = specialistChartPlan(
          group({ id, score: 55, criteria: Array.from({ length: criteria }, () => ({})) }),
          cardData,
          [],
        );
        assert.notEqual(plan.chart, "missing", `${id}, ${criteria} criteria`);
      }
    }
  }
});

test("T-918: a scored specialist with one criterion draws its score on a gauge", () => {
  const plan = specialistChartPlan(
    group({ id: "product_market_gtm", score: 72, criteria: [{}] }),
    searchedNothing(),
    [],
  );
  assert.deepEqual(plan, { chart: "scoreGauge", notFound: "market" });
});

test("two or more criteria are drawn as columns against the screening, with the not-found line", () => {
  const plan = specialistChartPlan(group({ id: "technology_risk" }), searchedNothing(), []);
  assert.deepEqual(plan, { chart: "criteria", notFound: "techBenchmarks" });
});

test("the figures a specialist found come before its criteria", () => {
  const plan = specialistChartPlan(
    group({ id: "people_team" }),
    searchedNothing({ people_team: figures(3) } as unknown as DeepCardData["highlights"]),
    [],
  );
  assert.equal(plan.chart, "highlights");
  assert.equal(plan.chart === "highlights" && plan.notFound, "team");
});

test("a run from before the card data keeps the criteria chart, without a not-found line", () => {
  assert.deepEqual(specialistChartPlan(group(), BEFORE_CARD_DATA, []), { chart: "criteriaMini" });
  assert.deepEqual(specialistChartPlan(group({ criteria: [{}] }), null, []), {
    chart: "criteriaMini",
  });
});

test("a team's own specialist keeps its figures, else its criteria", () => {
  const own = group({ id: "custom_regulatory" });
  assert.equal(
    specialistChartPlan(
      own,
      searchedNothing({ custom_regulatory: figures(2) } as unknown as DeepCardData["highlights"]),
      [],
    ).chart,
    "highlights",
  );
  assert.deepEqual(specialistChartPlan(own, searchedNothing(), []), { chart: "criteriaMini" });
});

test("an unscored specialist draws its findings, else what it wrote, else 'Mangler information'", () => {
  const unscored = group({
    id: "custom_regulatory",
    score: null,
    criteria: [],
    categories: ["regulatory"],
  });
  const findings = [
    { category: "regulatory", nature: "fact", confidence: 0.9 },
    { category: "regulatory", nature: "company_claim", confidence: null },
    { category: "team", nature: "fact", confidence: 0.9 },
  ];
  assert.deepEqual(specialistChartPlan(unscored, searchedNothing(), findings), {
    chart: "findings",
    count: 2,
    notFound: null,
  });
  assert.deepEqual(
    specialistChartPlan({ ...unscored, strengths: ["Licens i Norge"] }, searchedNothing(), []),
    { chart: "balance", notFound: null },
  );
  assert.deepEqual(specialistChartPlan(unscored, searchedNothing(), []), {
    chart: "missing",
    reason: null,
  });
  assert.deepEqual(
    specialistChartPlan(
      group({ id: "fund_finance_deal", score: null, criteria: [] }),
      searchedNothing(),
      [],
    ),
    { chart: "missing", reason: "Kilderne havde det ikke." },
  );
});

test("a team without three scored axes falls back instead of drawing a broken radar", () => {
  const cardData = searchedNothing();
  const person = (scores: Record<string, number | null>) => ({
    name: "A",
    role: "CEO",
    scores: {
      domain: null,
      execution: null,
      commercial: null,
      technical: null,
      leadership: null,
      ...scores,
    },
  });
  const withTeam = (people: unknown[]) =>
    ({
      ...cardData,
      team: { status: "found", data: { kind: "team", people }, reason: null },
    }) as unknown as DeepCardData;
  assert.equal(
    specialistChartPlan(group(), withTeam([person({ domain: 7, execution: 6 })]), []).chart,
    "criteria",
  );
  assert.equal(
    specialistChartPlan(group(), withTeam([person({ domain: 7, execution: 6, technical: 5 })]), [])
      .chart,
    "team",
  );
});
