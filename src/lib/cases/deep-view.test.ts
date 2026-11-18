import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analysisFocusKey,
  deepBasis,
  bridgeDomain,
  earlierBasisScreening,
  canStartDeepRun,
  deepTabs,
  economyView,
  firstSentences,
  heatBand,
  highRiskCount,
  cellMarker,
  matrixCells,
  numberRisks,
  parseDeepFocus,
  parseSpor,
  rationaleParagraphs,
  resolveTab,
  riskLevelSteps,
  scoreBridge,
  sortRisks,
  specialistGroups,
  specialistTopics,
  unitEconomics,
  weightedAverage,
  type DeepCriterionInput,
  type SpecialistDef,
} from "./deep-view.ts";

const MODULES: SpecialistDef[] = [
  {
    id: "people_team",
    title: "Founder, ledelse og team",
    categories: ["founder_market_fit", "team_market_fit"],
  },
  {
    id: "product_market_gtm",
    title: "Problem, produkt, PMF, marked og go-to-market",
    categories: ["product_market_fit", "market_timing", "traction_gtm"],
  },
  {
    id: "technology_risk",
    title: "Produktteknologi, data, IP og tværgående risici",
    categories: ["product_technology", "evidence_quality"],
  },
  {
    id: "fund_finance_deal",
    title: "Fondsmatch, økonomi, kapitalbehov og deal",
    categories: ["fund_thesis_fit", "financial_strength"],
  },
];

function criterion(
  key: string,
  category: string,
  score: number | null,
  weight: number,
  extra: Partial<DeepCriterionInput> = {},
): DeepCriterionInput {
  return {
    criterionKey: key,
    category,
    label: key,
    score,
    weight,
    confidence: null,
    verdict: null,
    rationale: "",
    positiveDrivers: [],
    negativeDrivers: [],
    unknowns: [],
    evidenceIds: [],
    ...extra,
  };
}

// A fund with eight criteria over all four specialists (weights add up to 100).
const DEEP = [
  criterion("fund", "fund_thesis_fit", 70, 10),
  criterion("founder", "founder_market_fit", 80, 20),
  criterion("team", "team_market_fit", 60, 10),
  criterion("pmf", "product_market_fit", 70, 15),
  criterion("timing", "market_timing", 50, 10),
  criterion("traction", "traction_gtm", 40, 10),
  criterion("tech", "product_technology", 90, 15),
  criterion("finance", "financial_strength", 60, 10),
];
const SCREENING = [
  { criterionKey: "fund", score: 65 },
  { criterionKey: "founder", score: 70 },
  { criterionKey: "team", score: 60 },
  { criterionKey: "pmf", score: 70 },
  { criterionKey: "timing", score: 55 },
  { criterionKey: "traction", score: 45 },
  { criterionKey: "tech", score: 80 },
  { criterionKey: "finance", score: 60 },
];

test("groups follow the fund's specialist modules, in the modules' order", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  assert.deepEqual(
    groups.map((group) => [group.id, group.label, group.criteria.map((row) => row.criterionKey)]),
    [
      ["people_team", "Team", ["founder", "team"]],
      ["product_market_gtm", "Produkt og marked", ["pmf", "timing", "traction"]],
      ["technology_risk", "Teknologi og IP", ["tech"]],
      ["fund_finance_deal", "Tese og deal", ["fund", "finance"]],
    ],
  );
});

test("grouping uses the category, not words in the label or key", () => {
  const groups = specialistGroups(
    [criterion("team_growth", "traction_gtm", 50, 100, { label: "Team og founder" })],
    [],
    MODULES,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.id, "product_market_gtm");
});

test("a module without criteria gets no group; criteria no module owns go to Øvrige kriterier", () => {
  const groups = specialistGroups(
    [criterion("a", "founder_market_fit", 80, 50), criterion("b", "mandate_fit", 60, 50)],
    [],
    MODULES,
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ["people_team", "ovrige"],
  );
  assert.equal(groups[1]!.label, "Øvrige kriterier");
  assert.equal(groups[1]!.criteria[0]!.criterionKey, "b");
});

test("a team's own specialist without criteria gets a tab with its own reading, no score (T-714)", () => {
  const groups = specialistGroups(
    [criterion("a", "founder_market_fit", 80, 100)],
    [],
    [
      ...MODULES,
      { id: "custom_impact", title: "Impact og klima", categories: [] },
      { id: "custom_silent", title: "Tavs", categories: [] },
    ],
    [
      {
        moduleId: "custom_impact",
        summary: "Klimaeffekten er tydelig.",
        strengths: ["Målbar CO2-reduktion"],
        weaknesses: ["Ingen tredjepartsmåling"],
        questions: ["Hvordan måles effekten?"],
        unknowns: ["Kundernes egne tal"],
      },
      { moduleId: "custom_silent", summary: null },
    ],
  );
  assert.deepEqual(
    groups.map((group) => group.id),
    ["people_team", "custom_impact"],
  );
  const own = groups[1]!;
  assert.equal(own.label, "Impact og klima");
  assert.equal(own.criteria.length, 0);
  assert.equal(own.score, null);
  assert.equal(own.pointsDelta, null);
  assert.equal(own.summary, "Klimaeffekten er tydelig.");
  assert.deepEqual(own.strengths, ["Målbar CO2-reduktion"]);
  assert.deepEqual(own.weaknesses, ["Ingen tredjepartsmåling"]);
  assert.deepEqual(own.questions, ["Hvordan måles effekten?"]);
  assert.deepEqual(own.unknowns, ["Kundernes egne tal"]);
});

test("a fund's own specialist (an unknown module id) gets a tab named by its title", () => {
  const groups = specialistGroups(
    [criterion("a", "custom_axis", 80, 100)],
    [],
    [{ id: "custom_specialist", title: "Bæredygtighed", categories: ["custom_axis"] }],
  );
  assert.equal(groups[0]!.label, "Bæredygtighed");
});

test("the specialist score is the weighted average of its criteria, in code", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  const team = groups.find((group) => group.id === "people_team")!;
  // (80×20 + 60×10) / 30 = 73.33
  assert.equal(team.score, 73);
  assert.equal(team.weight, 30);
  const product = groups.find((group) => group.id === "product_market_gtm")!;
  // (70×15 + 50×10 + 40×10) / 35 = 56.43
  assert.equal(product.score, 56);
});

test("delta since screening compares the same criteria with the same weights", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  const team = groups.find((group) => group.id === "people_team")!;
  // now 73.33 → 73, before (70×20 + 60×10) / 30 = 66.67 → 67
  assert.equal(team.delta, 6);
  assert.equal(team.screeningScore, 67);
  // 20 × 10 / 100 = +2.0 points in the total score
  assert.equal(team.pointsDelta, 2);
  const product = groups.find((group) => group.id === "product_market_gtm")!;
  assert.ok(product.delta !== null && product.delta < 0);
});

test("a criterion scored in only one run does not enter the delta", () => {
  const groups = specialistGroups(
    [criterion("a", "founder_market_fit", 80, 50), criterion("b", "team_market_fit", 40, 50)],
    [{ criterionKey: "a", score: 70 }],
    MODULES,
  );
  const team = groups[0]!;
  assert.equal(team.score, 60);
  assert.equal(team.delta, 10);
  assert.equal(team.pointsDelta, 5);
});

test("no screening, no delta", () => {
  const groups = specialistGroups(DEEP, [], MODULES);
  assert.ok(groups.every((group) => group.delta === null && group.pointsDelta === null));
  assert.ok(groups.every((group) => group.score !== null));
});

test("a group where nothing is scored has no score", () => {
  const groups = specialistGroups([criterion("a", "founder_market_fit", null, 100)], [], MODULES);
  assert.equal(groups[0]!.score, null);
  assert.equal(weightedAverage([]), null);
});

test("drivers, unknowns and evidence are merged without repeats", () => {
  const groups = specialistGroups(
    [
      criterion("a", "founder_market_fit", 80, 50, {
        positiveDrivers: ["Stærkt team", " Stærkt team "],
        unknowns: ["Reference mangler"],
        evidenceIds: ["e1", "e2"],
        confidence: 0.8,
      }),
      criterion("b", "team_market_fit", 60, 50, {
        positiveDrivers: ["Stærkt team", "Erfaring"],
        evidenceIds: ["e2", "e3"],
        confidence: 0.6,
      }),
    ],
    [],
    MODULES,
  );
  const team = groups[0]!;
  assert.deepEqual(team.strengths, ["Stærkt team", "Erfaring"]);
  assert.deepEqual(team.unknowns, ["Reference mangler"]);
  assert.equal(team.evidenceCount, 3);
  assert.ok(Math.abs((team.confidence ?? 0) - 0.7) < 1e-9);
});

test("the summary is the criteria's verdicts, else the first two sentences of the reasoning", () => {
  const withVerdict = specialistGroups(
    [
      criterion("a", "founder_market_fit", 80, 100, {
        verdict: "Stærkt team.",
        rationale: "Lang tekst.",
      }),
    ],
    [],
    MODULES,
  )[0]!;
  assert.equal(withVerdict.summary, "Stærkt team.");
  const fromText = specialistGroups(
    [
      criterion("a", "founder_market_fit", 80, 100, {
        rationale: "Første sætning. Anden sætning. Tredje sætning.",
      }),
    ],
    [],
    MODULES,
  )[0]!;
  assert.equal(fromText.summary, "Første sætning. Anden sætning.");
});

test("firstSentences does not cut at an abbreviation", () => {
  assert.equal(
    firstSentences("Runden er på 40 mio. kr. i alt. Næste sætning.", 1),
    "Runden er på 40 mio. kr. i alt.",
  );
});

test("the bridge adds the specialists' points between the two scores", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  const screening = 65.5;
  const deep = groups.reduce((sum, group) => sum + (group.pointsDelta ?? 0), screening);
  const steps = scoreBridge({ screeningScore: screening, deepScore: deep, groups })!;
  assert.deepEqual(
    steps.map((step) => step.key),
    [
      "screening",
      "people_team",
      "product_market_gtm",
      "technology_risk",
      "fund_finance_deal",
      "deep",
    ],
  );
  assert.equal(steps[0]!.value, screening);
  assert.equal(steps.at(-1)!.value, deep);
  // Every step starts where the last one ended.
  for (let index = 2; index < steps.length - 1; index += 1) {
    assert.ok(Math.abs(steps[index]!.from - steps[index - 1]!.to) < 1e-9);
  }
  // The fall is drawn in the critical colour.
  assert.equal(steps.find((step) => step.key === "product_market_gtm")!.color, "var(--critical)");
});

test("the bridge shows the remainder as its own step instead of hiding it", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  const explained = groups.reduce((sum, group) => sum + (group.pointsDelta ?? 0), 0);
  const steps = scoreBridge({ screeningScore: 60, deepScore: 60 + explained + 3, groups })!;
  const rest = steps.find((step) => step.key === "ovrige-aendringer");
  assert.ok(rest);
  assert.ok(Math.abs(rest.value - 3) < 1e-9);
  // A rounding-sized remainder is left out.
  const quiet = scoreBridge({ screeningScore: 60, deepScore: 60 + explained + 0.2, groups })!;
  assert.equal(
    quiet.some((step) => step.key === "ovrige-aendringer"),
    false,
  );
});

test("no bridge without both scores", () => {
  assert.equal(scoreBridge({ screeningScore: null, deepScore: 70, groups: [] }), null);
  assert.equal(scoreBridge({ screeningScore: 70, deepScore: null, groups: [] }), null);
});

test("the bridge scale holds every bar and the threshold, in 5-point steps", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  const steps = scoreBridge({ screeningScore: 64, deepScore: 70, groups })!;
  const { lo, hi } = bridgeDomain(steps, 70);
  assert.equal(lo % 5, 0);
  assert.equal(hi % 5, 0);
  assert.ok(lo <= 60 && hi >= 75);
  assert.ok(hi - lo >= 10);
  const wide = bridgeDomain(steps, 98);
  assert.ok(wide.hi <= 100 && wide.hi >= 98);
});

test("risks: critical first, then exposure; the model's order breaks ties", () => {
  const risks = [
    { id: "a", level: "medium" as const, likelihood: 5, impact: 5 },
    { id: "b", level: "critical" as const, likelihood: 2, impact: 2 },
    { id: "c", level: "high" as const, likelihood: 3, impact: 4 },
    { id: "d", level: "high" as const, likelihood: 3, impact: 4 },
    { id: "e", level: "high" as const, likelihood: null, impact: null },
  ];
  assert.deepEqual(
    sortRisks(risks).map((risk) => risk.id),
    ["b", "c", "d", "e", "a"],
  );
  assert.equal(highRiskCount(risks), 4);
});

test("tabs: Konklusion, the specialists, then Økonomi and Risici only when there is something to show", () => {
  const groups = specialistGroups(DEEP, SCREENING, MODULES);
  assert.deepEqual(
    deepTabs(groups, { economy: true, risks: true }).map((tab) => tab.key),
    [
      "konklusion",
      "people_team",
      "product_market_gtm",
      "technology_risk",
      "fund_finance_deal",
      "okonomi",
      "risici",
    ],
  );
  assert.deepEqual(
    deepTabs(groups, { economy: false, risks: false }).map((tab) => tab.key),
    ["konklusion", "people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"],
  );
  const economy = deepTabs(groups, { economy: true, risks: false }).find(
    (tab) => tab.key === "okonomi",
  );
  assert.equal(economy?.caption, "Nøgletal");
});

test("tab figures: standard specialists, a team's own ones by their place, Økonomi; none on Konklusion and Risici (T-683)", () => {
  const groups = specialistGroups(
    [...DEEP, criterion("x", "own_axis_a", 70, 10), criterion("y", "own_axis_b", 60, 10)],
    SCREENING,
    [
      ...MODULES,
      { id: "own_a", title: "Bæredygtighed", categories: ["own_axis_a"] },
      { id: "own_b", title: "Regulering", categories: ["own_axis_b"] },
    ],
  );
  const figures = Object.fromEntries(
    deepTabs(groups, { economy: true, risks: true }).map((tab) => [tab.key, tab.figure]),
  );
  assert.deepEqual(figures, {
    konklusion: null,
    people_team: "team",
    product_market_gtm: "market",
    technology_risk: "tech",
    fund_finance_deal: "deal",
    own_a: "own1",
    own_b: "own2",
    okonomi: "finance",
    risici: null,
  });
});

test("spor from the URL: a tab that does not exist falls back to Konklusion", () => {
  const tabs = deepTabs(specialistGroups(DEEP, SCREENING, MODULES), {
    economy: false,
    risks: true,
  });
  assert.equal(resolveTab(tabs, "people_team"), "people_team");
  assert.equal(resolveTab(tabs, "risici"), "risici");
  assert.equal(resolveTab(tabs, "okonomi"), "konklusion");
  assert.equal(resolveTab(tabs, "noget-andet"), "konklusion");
  assert.equal(resolveTab(tabs, undefined), "konklusion");
});

test("parseSpor drops invalid values and the default", () => {
  assert.equal(parseSpor("people_team"), "people_team");
  assert.equal(parseSpor("risici"), "risici");
  assert.equal(parseSpor("konklusion"), undefined);
  assert.equal(parseSpor("../etc"), undefined);
  assert.equal(parseSpor("A B"), undefined);
  assert.equal(parseSpor(""), undefined);
  assert.equal(parseSpor(7), undefined);
  assert.equal(parseSpor("x".repeat(41)), undefined);
});

test("reasoning is split into paragraphs of at most three sentences and keeps the model's breaks", () => {
  assert.deepEqual(rationaleParagraphs("Én. To."), ["Én. To."]);
  assert.deepEqual(rationaleParagraphs("A a. B b. C c. D d."), ["A a. B b.", "C c. D d."]);
  assert.deepEqual(rationaleParagraphs("A a. B b. C c. D d. E e. F f."), [
    "A a. B b. C c.",
    "D d. E e. F f.",
  ]);
  assert.deepEqual(rationaleParagraphs("Første afsnit.\n\nAnden afsnit."), [
    "Første afsnit.",
    "Anden afsnit.",
  ]);
  assert.deepEqual(rationaleParagraphs("  "), []);
  // "mio. kr." is not a sentence end.
  assert.deepEqual(rationaleParagraphs("Runden er 40 mio. kr. stor. Den er høj."), [
    "Runden er 40 mio. kr. stor. Den er høj.",
  ]);
});

// ---------------------------------------------------------------------------
// Batch 2: risks, analyses, sub-page keys, Økonomi
// ---------------------------------------------------------------------------

function risk(level: "low" | "medium" | "high" | "critical", l: number | null, i: number | null) {
  return { level, likelihood: l, impact: i };
}

test("risks are numbered in the sorted order, the same for matrix and list", () => {
  const numbered = numberRisks([
    { ...risk("medium", 2, 2), id: "a" },
    { ...risk("critical", 5, 4), id: "b" },
    { ...risk("high", 3, 4), id: "c" },
  ]);
  assert.deepEqual(
    numbered.map((entry) => [entry.number, entry.risk.id]),
    [
      [1, "b"],
      [2, "c"],
      [3, "a"],
    ],
  );
  // The marker in the matrix carries the same number as the list.
  const cells = matrixCells(numbered);
  assert.equal(cells.length, 25);
  const marked = cells.flatMap((cell) =>
    cell.entries.map((entry) => [entry.number, cell.likelihood, cell.impact]),
  );
  assert.deepEqual(marked.sort(), [
    [1, 5, 4],
    [2, 3, 4],
    [3, 2, 2],
  ]);
});

test("the matrix puts the highest impact on top and the lowest likelihood on the left", () => {
  const cells = matrixCells(numberRisks([risk("low", 1, 5)]));
  assert.deepEqual([cells[0]!.likelihood, cells[0]!.impact], [1, 5]);
  assert.equal(cells[0]!.entries.length, 1);
  assert.deepEqual([cells[24]!.likelihood, cells[24]!.impact], [5, 1]);
});

test("a risk without coordinates stays in the list, never in the matrix; ratings are clamped", () => {
  const numbered = numberRisks([risk("high", null, 3), risk("high", 9, 0)]);
  const placed = matrixCells(numbered).flatMap((cell) => cell.entries);
  assert.equal(placed.length, 1);
  assert.equal(placed[0]!.number, 2);
  const clamped = matrixCells(numbered).find((cell) => cell.entries.length > 0)!;
  assert.deepEqual([clamped.likelihood, clamped.impact], [5, 1]);
});

test("heat bands follow likelihood × impact (16, 10, 5)", () => {
  assert.equal(heatBand(4, 4), "critical");
  assert.equal(heatBand(5, 2), "high");
  assert.equal(heatBand(3, 2), "medium");
  assert.equal(heatBand(2, 2), "none");
  assert.equal(riskLevelSteps("critical"), 4);
  assert.equal(riskLevelSteps("low"), 1);
});

const CATEGORY_LABELS = { founder_market_fit: "Founder-market fit", team_market_fit: "Team" };
function finding(category: string, findingType: string, statement: string, confidence = 0.8) {
  return { category, findingType, statement, confidence, nature: "fact" };
}

test("findings are grouped by the specialist's categories; a category without findings gets no card", () => {
  const topics = specialistTopics(
    [
      finding("team_market_fit", "strength", "Stærkt driftsteam."),
      finding("founder_market_fit", "assessment", "Founderne kender branchen. De har bygget før."),
      finding("founder_market_fit", "weakness", "Ingen salgsleder."),
      finding("founder_market_fit", "unknown", "Aftaler om ejerandele."),
      finding("founder_market_fit", "question", "Hvem er CFO?"),
      finding("market_timing", "strength", "Ejes af en anden specialist."),
    ],
    ["founder_market_fit", "team_market_fit", "evidence_quality"],
    CATEGORY_LABELS,
  );
  assert.deepEqual(
    topics.map((topic) => topic.key),
    ["founder_market_fit", "team_market_fit"],
  );
  const founder = topics[0]!;
  assert.equal(founder.label, "Founder-market fit");
  assert.equal(founder.up.length, 0);
  assert.deepEqual(
    founder.down.map((item) => item.statement),
    ["Ingen salgsleder."],
  );
  assert.equal(founder.open.length, 2);
  // The card's sentence is the first reading, cut to one sentence.
  assert.equal(founder.answer, "Founderne kender branchen.");
  // No reading: the first finding stands in.
  assert.equal(topics[1]!.answer, "Stærkt driftsteam.");
  assert.equal(founder.confidence, 0.8);
});

test("no findings, no topics; blank statements and unknown labels are handled", () => {
  assert.deepEqual(specialistTopics([], ["founder_market_fit"], CATEGORY_LABELS), []);
  const topics = specialistTopics(
    [finding("custom_axis", "strength", "Noget."), finding("custom_axis", "weakness", "  ")],
    ["custom_axis"],
    {},
  );
  assert.equal(topics[0]!.label, "custom axis");
  assert.equal(topics[0]!.findings.length, 1);
  assert.equal(topics[0]!.confidence, 0.8);
  assert.equal(
    specialistTopics([{ ...finding("a", "strength", "x"), confidence: null }], ["a"], {})[0]!
      .confidence,
    null,
  );
});

test("fokus from the URL accepts the known sub-pages and analyse-<category> only", () => {
  assert.equal(parseDeepFocus("hvorfor"), "hvorfor");
  assert.equal(parseDeepFocus("omsaetning"), "omsaetning");
  assert.equal(parseDeepFocus("unit-economics"), "unit-economics");
  assert.equal(parseDeepFocus(analysisFocusKey("team_market_fit")), "analyse-team_market_fit");
  assert.equal(parseDeepFocus("analyse-"), undefined);
  assert.equal(parseDeepFocus("analyse-../x"), undefined);
  assert.equal(parseDeepFocus("profil"), undefined);
  assert.equal(parseDeepFocus(undefined), undefined);
  assert.equal(parseDeepFocus(3), undefined);
});

// A report with only the figures a test needs (series are oldest first).
function makeMetric(
  key: string,
  values: Array<number | null>,
  years: string[],
  extra: { latestStatus?: "ok" | "estimat" | "kan_ikke_beregnes" } = {},
) {
  const series = values.map((value, index) => ({
    periodEnd: years[index]!,
    value,
    status: value === null ? ("kan_ikke_beregnes" as const) : (extra.latestStatus ?? "ok"),
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
const YEARS = ["2022-12-31", "2023-12-31", "2024-12-31"];
function makeReport(metrics: ReturnType<typeof makeMetric>[]) {
  return {
    version: "interlect-financial-metrics-v1" as const,
    asOf: "2026-09-30",
    years: YEARS,
    metrics,
  };
}

test("Økonomi: no report or no years, no view", () => {
  assert.equal(economyView(null), null);
  assert.equal(economyView({ ...makeReport([]), years: [] }), null);
});

test("Økonomi: revenue, margin, burn and runway cards follow the real figures", () => {
  const view = economyView(
    makeReport([
      makeMetric("revenue", [3_100_000, 8_000_000, 14_200_000], YEARS),
      makeMetric("revenue_growth", [null, 158, 77], YEARS),
      makeMetric("gross_margin", [29, 35, 41], YEARS),
      makeMetric("cash", [1_000_000, 4_000_000, 8_500_000], YEARS),
      makeMetric("operating_burn", [null, null, 700_000], YEARS),
      makeMetric("runway_today", [null, null, 9], YEARS),
      makeMetric("runway_at_balance_date", [null, null, 12], YEARS),
    ]),
  )!;
  assert.deepEqual(
    view.kpis.map((kpi) => kpi.key),
    ["revenue", "gross_margin", "operating_burn", "runway_today"],
  );
  assert.deepEqual(view.kpis[0]!.delta, { kind: "growth", value: 77 });
  assert.deepEqual(view.kpis[1]!.delta, { kind: "points", value: 6 });
  assert.equal(view.revenueCard?.series, "revenue");
  assert.equal(view.revenueCard?.hasMargin, true);
  assert.equal(view.cashCard?.projection?.cash, 8_500_000);
  assert.equal(view.cashCard?.projection?.months, 12);
  assert.equal(view.cashCard?.projection?.monthsFromToday, 9);
  assert.equal(view.years.length, 3);
});

test("Økonomi: gross profit stands in for revenue, and no margin card without margins", () => {
  const view = economyView(
    makeReport([makeMetric("gross_profit", [1_000_000, 1_500_000, 2_000_000], YEARS)]),
  )!;
  assert.equal(view.kpis[0]!.label, "Bruttofortjeneste");
  assert.equal(view.revenueCard?.series, "gross_profit");
  assert.equal(view.revenueCard?.hasMargin, false);
  assert.equal(
    view.kpis.some((kpi) => kpi.key === "gross_margin"),
    false,
  );
});

test("Økonomi: no cash, no burn, runway or likviditet card; a figure the code could not calculate says so", () => {
  const noCash = economyView(
    makeReport([
      makeMetric("revenue", [1, 2, 3], YEARS),
      makeMetric("operating_burn", [null, null, 5], YEARS),
    ]),
  )!;
  assert.equal(noCash.cashCard, null);
  assert.deepEqual(
    noCash.kpis.map((kpi) => kpi.key),
    ["revenue"],
  );
  const cannot = economyView(
    makeReport([
      makeMetric("cash", [null, null, 2_000_000], YEARS),
      makeMetric("operating_burn", [null, null, 0], YEARS),
      makeMetric("runway_today", [null, null, null], YEARS),
    ]),
  )!;
  assert.equal(cannot.revenueCard, null);
  assert.equal(cannot.kpis.find((kpi) => kpi.key === "runway_today")!.value, null);
  assert.equal(cannot.kpis.find((kpi) => kpi.key === "operating_burn")!.value, 0);
  // Cash, but no runway at the balance date: the card stays, without a projection.
  assert.equal(cannot.cashCard?.projection, null);
});

test("Økonomi: the view reads only the last six years", () => {
  const years = Array.from({ length: 8 }, (_, index) => `${2018 + index}-12-31`);
  const report = {
    ...makeReport([
      makeMetric(
        "revenue",
        years.map((_, index) => index + 1),
        years,
      ),
    ]),
    years,
  };
  const view = economyView(report)!;
  assert.deepEqual(
    view.years.map((year) => year.year),
    ["2020", "2021", "2022", "2023", "2024", "2025"],
  );
});

test("unit economics: only figures the code could calculate; none means no card", () => {
  const calc = (metric: string, value: number | null, status = "ok") => ({
    metric,
    status,
    value,
    unit: "x",
    missingInputs: [],
    warnings: [],
  });
  assert.equal(
    unitEconomics([calc("ltv", null, "kan_ikke_beregnes"), calc("cac", null, "kan_ikke_beregnes")]),
    null,
  );
  assert.equal(unitEconomics([]), null);
  const view = unitEconomics([
    calc("mrr", 10),
    calc("cac", 380_000),
    calc("ltv", 1_600_000),
    calc("ltv_cac", 4.2),
    calc("cac_payback", null, "kan_ikke_beregnes"),
  ])!;
  assert.deepEqual(
    view.rows.map((row) => row.metric),
    ["ltv", "cac", "ltv_cac"],
  );
  assert.equal(view.ratio, 4.2);
  assert.equal(view.payback, null);
  assert.equal(view.cac?.value, 380_000);
});

test("deepBasis: delta only against a screening the analysis could be built on", () => {
  const history = [
    { kind: "deep", status: "complete" },
    { kind: "screening", status: "complete" },
  ];
  const same = deepBasis({
    deepStartedAt: "2026-09-30T10:00:00Z",
    deepCompletedAt: "2026-09-30T10:05:00Z",
    screeningStartedAt: "2026-09-29T10:00:00Z",
    history,
  });
  assert.equal(same.screeningIsNewer, false);
  assert.equal(same.note, null);
  const newer = deepBasis({
    deepStartedAt: "2026-09-30T10:00:00Z",
    deepCompletedAt: "2026-09-30T10:05:00Z",
    screeningStartedAt: "2026-10-01T08:00:00Z",
    history,
  });
  assert.equal(newer.screeningIsNewer, true);
  assert.match(newer.note ?? "", /før den seneste screening/);
  assert.match(newer.note ?? "", /30\. sep\.? 2026/);
});

test("deepBasis: a failed newest deep run labels the shown one as the last successful", () => {
  const failed = deepBasis({
    deepStartedAt: "2026-09-30T10:00:00Z",
    deepCompletedAt: "2026-09-30T10:05:00Z",
    screeningStartedAt: "2026-09-29T10:00:00Z",
    history: [
      { kind: "deep", status: "failed" },
      { kind: "deep", status: "complete" },
    ],
  });
  assert.equal(failed.latestRunFailed, true);
  assert.equal(failed.screeningIsNewer, false);
  assert.match(failed.note ?? "", /^Seneste vellykkede analyse, d\. /);
  const both = deepBasis({
    deepStartedAt: "2026-09-30T10:00:00Z",
    deepCompletedAt: null,
    screeningStartedAt: "2026-10-01T08:00:00Z",
    history: [{ kind: "deep", status: "failed" }],
  });
  assert.match(both.note ?? "", /Seneste vellykkede analyse/);
  assert.match(both.note ?? "", /ændringen siden screening vises ikke/);
  assert.equal(
    deepBasis({
      deepStartedAt: "2026-09-30T10:00:00Z",
      deepCompletedAt: null,
      screeningStartedAt: null,
      history: [],
    }).note,
    null,
  );
});

test("deepBasis: the analysis's own screening decides by id and the change is shown against it (T-807)", () => {
  const history = [
    { kind: "screening", status: "complete" },
    { kind: "deep", status: "complete" },
  ];
  const base = {
    deepStartedAt: "2026-09-30T10:00:00Z",
    deepCompletedAt: "2026-09-30T10:05:00Z",
    history,
  };
  // Built on the latest screening: no note, even if the clocks disagree.
  const same = deepBasis({
    ...base,
    screeningStartedAt: "2026-10-01T08:00:00Z",
    screeningId: "s-1",
    basisScreeningId: "s-1",
  });
  assert.equal(same.screeningIsNewer, false);
  assert.equal(same.note, null);
  // Another screening is the latest, even one that began before the analysis did.
  const other = deepBasis({
    ...base,
    screeningStartedAt: "2026-09-30T09:59:00Z",
    screeningId: "s-2",
    basisScreeningId: "s-1",
  });
  assert.equal(other.screeningIsNewer, true);
  assert.match(other.note ?? "", /ændringen siden screening vises ikke/i);
  // With the analysis's own screening loaded, the change is shown against it.
  const shown = deepBasis({
    ...base,
    screeningStartedAt: "2026-10-01T08:00:00Z",
    screeningId: "s-2",
    basisScreeningId: "s-1",
    basisScreeningLoaded: true,
  });
  assert.equal(shown.screeningIsNewer, true);
  assert.match(shown.note ?? "", /Ændringen vises mod den screening, analysen bygger på\.$/);
  assert.doesNotMatch(shown.note ?? "", /vises ikke/);
  const failedShown = deepBasis({
    ...base,
    screeningStartedAt: "2026-10-01T08:00:00Z",
    screeningId: "s-2",
    basisScreeningId: "s-1",
    basisScreeningLoaded: true,
    history: [{ kind: "deep", status: "failed" }, ...history],
  });
  assert.match(failedShown.note ?? "", /^Seneste vellykkede analyse/);
  assert.match(failedShown.note ?? "", /Ændringen vises mod den screening, analysen bygger på\.$/);
  // Older data without the id: the start times decide as before.
  const legacy = deepBasis({
    ...base,
    screeningStartedAt: "2026-10-01T08:00:00Z",
    basisScreeningId: null,
    screeningId: "s-2",
  });
  assert.equal(legacy.screeningIsNewer, true);
});

test("earlierBasisScreening: the loaded screening the analysis was built on, else none", () => {
  const earlier = [{ id: "s-1", score: 70 }];
  assert.equal(earlierBasisScreening({ basisScreeningId: "s-1" }, earlier), earlier[0]);
  assert.equal(earlierBasisScreening({ basisScreeningId: "s-9" }, earlier), null);
  assert.equal(earlierBasisScreening({ basisScreeningId: null }, earlier), null);
});

test("specialist summary: the specialist's own text wins, older runs fall back to verdicts", () => {
  const withOwn = specialistGroups(DEEP, SCREENING, MODULES, [
    { moduleId: "people_team", summary: "  Teamet er stærkt og komplementært.  " },
    { moduleId: "product_market_gtm", summary: null },
  ]);
  assert.equal(withOwn[0]!.summary, "Teamet er stærkt og komplementært.");
  const fallback = specialistGroups(
    [criterion("founder", "founder_market_fit", 80, 20, { verdict: "Stærkt hold." })],
    [],
    MODULES,
    [{ moduleId: "people_team", summary: null }],
  );
  assert.equal(fallback[0]!.summary, "Stærkt hold.");
});

test("canStartDeepRun: a failed or cancelled re-run can be retried even after an older complete one", () => {
  const screening = { kind: "screening", status: "complete" };
  assert.equal(canStartDeepRun([screening]), true);
  assert.equal(canStartDeepRun([]), false);
  assert.equal(canStartDeepRun([{ kind: "deep", status: "running" }, screening]), false);
  assert.equal(canStartDeepRun([{ kind: "deep", status: "complete" }, screening]), false);
  assert.equal(canStartDeepRun([{ kind: "deep", status: "failed" }, screening]), true);
  assert.equal(
    canStartDeepRun([
      { kind: "deep", status: "cancelled" },
      { kind: "deep", status: "complete" },
      screening,
    ]),
    true,
  );
  assert.equal(
    canStartDeepRun([
      { kind: "deep", status: "complete" },
      { kind: "deep", status: "failed" },
      screening,
    ]),
    false,
  );
});

test("Økonomi: the margin change is against the year right before, not an older figure", () => {
  const view = economyView(
    makeReport([
      makeMetric("revenue", [1, 2, 3], YEARS),
      makeMetric("gross_margin", [29, null, 41], YEARS),
    ]),
  )!;
  const margin = view.kpis.find((kpi) => kpi.key === "gross_margin")!;
  assert.equal(margin.delta, null);
});

test("a matrix cell with several risks shows one marker, never numbers on top of each other (D05)", () => {
  const numbered = numberRisks([
    risk("critical", 4, 4),
    risk("high", 4, 4),
    risk("high", 4, 4),
    risk("medium", 4, 4),
    risk("low", 1, 1),
  ]);
  const cells = matrixCells(numbered);
  const busy = cells.find((cell) => cell.likelihood === 4 && cell.impact === 4)!;
  const marker = cellMarker(busy.entries)!;
  assert.equal(marker.label, "1–4");
  assert.deepEqual(marker.numbers, [1, 2, 3, 4]);
  assert.equal(marker.risk.level, "critical");
  const single = cells.find((cell) => cell.likelihood === 1 && cell.impact === 1)!;
  assert.equal(cellMarker(single.entries)!.label, "5");
  assert.equal(cellMarker([]), null);
  const apart = numbered.filter((entry) => entry.number === 2 || entry.number === 5);
  assert.equal(cellMarker(apart)!.label, "2, 5");
  const spread = numbered.filter((entry) => entry.number !== 2);
  assert.equal(cellMarker(spread)!.label, "1, 3–5");
  const scattered = numbered.filter((entry) => entry.number % 2 === 1);
  assert.equal(cellMarker(scattered)!.label, "1, 3 …");
  assert.deepEqual(cellMarker(scattered)!.numbers, [1, 3, 5]);
});
