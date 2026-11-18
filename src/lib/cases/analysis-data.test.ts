import { test } from "node:test";
import assert from "node:assert/strict";
import type { DeepCardData } from "../analysis/card-data.ts";
import { amountText, dataTopics, isDataTopicKey, techValueText } from "./analysis-data.ts";
import { analysisFocusKey, parseDeepFocus } from "./deep-view.ts";

const none = { status: "not_found", data: null, reason: null } as const;

function cardData(overrides: Partial<DeepCardData>): DeepCardData {
  return {
    team: none,
    market: none,
    techBenchmarks: none,
    ownership: none,
    highlights: {},
    ...overrides,
  };
}

const team: DeepCardData["team"] = {
  status: "found",
  reason: null,
  data: {
    kind: "team",
    notFound: null,
    people: [
      {
        name: "Jeppe Rindom",
        role: "CEO",
        scores: { domain: 9, execution: 8, commercial: 7, technical: null, leadership: 8 },
        evidenceIds: ["e1", "e2"],
      },
      {
        name: "Niccolo Perras",
        role: "",
        scores: { domain: 5, execution: null, commercial: null, technical: 6, leadership: null },
        evidenceIds: ["e2"],
      },
    ],
  },
};

test("team: one bar per person with the mean of the axes it has; the strongest is strong", () => {
  const [topic] = dataTopics("people_team", cardData({ team }), "da");
  assert.ok(topic);
  assert.equal(topic.key, "data_team");
  assert.equal(topic.headline, "2 personer");
  assert.deepEqual(
    topic.bars.map((bar) => [bar.label, bar.value, bar.fraction, bar.strong]),
    [
      ["Jeppe Rindom", "8/10", 0.8, true],
      ["Niccolo Perras", "5,5/10", 0.55, false],
    ],
  );
  assert.match(topic.answer, /Jeppe Rindom står stærkest/);
  assert.equal(topic.found[0], "Jeppe Rindom, CEO: stærkest på Branche (9/10).");
  assert.equal(topic.found[1], "Niccolo Perras: stærkest på Teknik (6/10).");
  assert.doesNotMatch(topic.note, /Bygger på/);
});

test("market: years in order, the newest strong, forecasts marked, amounts with unit and currency", () => {
  const market: DeepCardData["market"] = {
    status: "found",
    reason: null,
    data: {
      kind: "market",
      label: "Spend management",
      scope: "sam",
      geography: "Europa",
      currency: "EUR",
      unit: "billion",
      notFound: null,
      points: [
        { year: 2030, value: 9.4, basis: "forecast", evidenceIds: ["m1"] },
        { year: 2024, value: 0, basis: "actual", evidenceIds: ["m1"] },
        { year: 2026, value: 5.1, basis: "actual", evidenceIds: ["m2"] },
      ],
    },
  };
  const [topic] = dataTopics("product_market_gtm", cardData({ market }), "da");
  assert.ok(topic);
  assert.deepEqual(
    topic.bars.map((bar) => [bar.label, bar.value, bar.strong]),
    [
      ["2024", "0 mia. EUR", false],
      ["2026", "5,1 mia. EUR", false],
      ["2030 (prognose)", "9,4 mia. EUR", true],
    ],
  );
  assert.equal(topic.bars[0]!.fraction, 0);
  assert.equal(topic.headline, "9,4 mia. EUR i 2030 (prognose)");
  assert.equal(
    topic.answer,
    "Spend management, Europa: fra 0 mia. EUR i 2024 til 9,4 mia. EUR i 2030 (prognose).",
  );
});

test("tech: company and industry per figure, scaled within the pair; 'better' respects the direction", () => {
  const techBenchmarks: DeepCardData["techBenchmarks"] = {
    status: "found",
    reason: null,
    data: {
      kind: "techBenchmarks",
      notFound: null,
      items: [
        {
          metric: "Dødelighed",
          unit: "%",
          company: 4,
          industry: 9,
          higherIsBetter: false,
          evidenceIds: ["t1"],
        },
        {
          metric: "Oppetid",
          unit: "%",
          company: 99.9,
          industry: 99.95,
          higherIsBetter: true,
          evidenceIds: ["t2"],
        },
        {
          metric: "Patenter",
          unit: "",
          company: 3,
          industry: null,
          higherIsBetter: true,
          evidenceIds: ["t3"],
        },
        {
          metric: "Negativ",
          unit: "",
          company: -2,
          industry: 0,
          higherIsBetter: true,
          evidenceIds: ["t3"],
        },
      ],
    },
  };
  const [topic] = dataTopics("technology_risk", cardData({ techBenchmarks }), "da");
  assert.ok(topic);
  assert.equal(topic.headline, "4 nøgletal");
  assert.equal(topic.answer, "Selskabet ligger bedre end branchen på 1 af 3 nøgletal.");
  const mortality = topic.bars.filter((bar) => bar.label.startsWith("Dødelighed"));
  assert.deepEqual(
    mortality.map((bar) => [bar.value, Number(bar.fraction.toFixed(3)), bar.strong]),
    [
      ["4 %", 0.444, true],
      ["9 %", 1, false],
    ],
  );
  // A figure without the other side is a field, never a bar measured against itself,
  // and "Det fandt vi" says which side is not stated, in a whole sentence.
  assert.equal(topic.bars.filter((bar) => bar.label.startsWith("Patenter")).length, 0);
  assert.deepEqual(topic.fields, [{ label: "Patenter", value: "3" }]);
  assert.equal(topic.found[2], "Patenter: selskabet 3. Branchens niveau er ikke oplyst.");
  assert.equal(topic.chartTitle, "Selskabet og branchen");
  assert.equal(
    topic.note,
    "Hvert par er målt i samme enhed. Et tal uden den anden side står for sig.",
  );
  // A negative figure never draws below zero or past the track.
  for (const bar of topic.bars) assert.ok(bar.fraction >= 0 && bar.fraction <= 1);
});

test("tech without industry figures (T-920): fields, no bars, and a title and note that say so", () => {
  const item = (metric: string, unit: string, company: number) => ({
    metric,
    unit,
    company,
    industry: null,
    higherIsBetter: true,
    evidenceIds: [metric],
  });
  const techBenchmarks: DeepCardData["techBenchmarks"] = {
    status: "found",
    reason: null,
    data: {
      kind: "techBenchmarks",
      notFound: null,
      items: [
        item("Jurisdictions covered", "count", 250),
        item("Routine cases automated", "percent", 80),
        item("Entities screened", "count", 11_500_000),
      ],
    },
  };
  const [topic] = dataTopics("technology_risk", cardData({ techBenchmarks }), "en");
  assert.ok(topic);
  assert.deepEqual(topic.bars, []);
  assert.deepEqual(topic.fields, [
    { label: "Jurisdictions covered", value: "250" },
    { label: "Routine cases automated", value: "80 %" },
    { label: "Entities screened", value: "11,500,000" },
  ]);
  assert.equal(topic.chartTitle, "The company's key figures");
  assert.equal(
    topic.answer,
    "The sources give the company's figures, but not the industry's level for any of them.",
  );
  assert.equal(
    topic.note,
    "Nothing is compared: no key figure has both the company's and the industry's figure.",
  );
  assert.equal(
    topic.found[1],
    "Routine cases automated: the company 80 %. The industry's level is not stated.",
  );

  // Only the industry's level for one figure: still a field, and the title does not say "the company".
  const [industryOnly] = dataTopics(
    "technology_risk",
    cardData({
      techBenchmarks: {
        status: "found",
        reason: null,
        data: {
          kind: "techBenchmarks",
          notFound: null,
          items: [{ ...item("Uptime", "%", 0), company: null, industry: 99.9 }],
        },
      },
    }),
    "da",
  );
  assert.ok(industryOnly);
  assert.deepEqual(industryOnly.fields, [{ label: "Uptime, branchen", value: "99,9 %" }]);
  assert.equal(industryOnly.chartTitle, "Fundne nøgletal");
  assert.equal(industryOnly.found[0], "Uptime: branchen 99,9 %. Selskabets tal er ikke oplyst.");
});

test("techValueText: written-out units read as the cards say them", () => {
  assert.equal(techValueText(80, "percent", "en"), "80 %");
  assert.equal(techValueText(80, " Percent ", "da"), "80 %");
  assert.equal(techValueText(7, "count", "en"), "7");
  assert.equal(techValueText(3, "", "da"), "3");
  assert.equal(techValueText(120, "ms", "en"), "120 ms");
  assert.equal(techValueText(1.5, "TB", "da"), "1,5 TB");
});

test("ownership: shares largest first; rounds only compare one currency, a missing amount says so", () => {
  const ownership: DeepCardData["ownership"] = {
    status: "found",
    reason: null,
    data: {
      kind: "ownership",
      notFound: null,
      holders: [
        {
          holder: "Seed-investorer",
          holderType: "investor",
          percent: 22.9,
          asOf: null,
          evidenceIds: ["o1"],
        },
        {
          holder: "Founders",
          holderType: "founder",
          percent: 54.6,
          asOf: "2025-06-01",
          evidenceIds: ["o1"],
        },
      ],
      rounds: [
        {
          name: "Serie A",
          date: "2025-03",
          amount: 40_000_000,
          currency: "DKK",
          investors: ["Fond X"],
          evidenceIds: ["r1"],
        },
        {
          name: "Seed",
          date: "2023-01",
          amount: 8_000_000,
          currency: "DKK",
          investors: [],
          evidenceIds: ["r1"],
        },
        {
          name: "Bro",
          date: "2024-05",
          amount: 2_000_000,
          currency: "EUR",
          investors: [],
          evidenceIds: ["r2"],
        },
        {
          name: "Pre-seed",
          date: null,
          amount: null,
          currency: null,
          investors: [],
          evidenceIds: ["r2"],
        },
      ],
    },
  };
  const topics = dataTopics("fund_finance_deal", cardData({ ownership }), "da");
  assert.deepEqual(
    topics.map((topic) => topic.key),
    ["data_ownership", "data_rounds"],
  );
  const [shares, rounds] = topics as [(typeof topics)[0], (typeof topics)[0]];
  assert.equal(shares.answer, "Den største ejer er Founders med 54,6 % (opgjort 2025-06-01).");
  assert.deepEqual(
    shares.bars.map((bar) => [bar.label, bar.strong]),
    [
      ["Founders", true],
      ["Seed-investorer", false],
    ],
  );
  assert.equal(rounds.headline, "4 runder");
  const byLabel = Object.fromEntries(rounds.bars.map((bar) => [bar.label, bar]));
  assert.equal(byLabel["Serie A, 2025"]!.fraction, 1);
  assert.equal(byLabel["Seed, 2023"]!.fraction, 0.2);
  assert.equal(byLabel["Bro, 2024"]!.fraction, 0, "EUR is not compared with DKK");
  assert.equal(byLabel["Pre-seed"]!.value, "Ikke oplyst");
  assert.equal(rounds.answer, "Seneste runde er Serie A, 2025 på 40 mio. DKK.");
  assert.equal(rounds.found.at(-1), "Serie A, 2025: 40 mio. DKK fra Fond X.");
});

test("rounds without an ISO date are never called the latest, and their date is shown as written", () => {
  const rounds = (dates: (string | null)[]): DeepCardData["ownership"] => ({
    status: "found",
    reason: null,
    data: {
      kind: "ownership",
      notFound: null,
      holders: [],
      rounds: dates.map((date, index) => ({
        name: `R${index + 1}`,
        date,
        amount: 1_000_000,
        currency: "DKK",
        investors: [],
        evidenceIds: ["r"],
      })),
    },
  });
  const [undated] = dataTopics("fund_finance_deal", cardData({ ownership: rounds([null, null]) }));
  assert.equal(undated!.answer, "Kilderne nævner 2 runder, men ikke hvornår de blev rejst.");
  assert.ok(undated!.bars.every((bar) => !bar.strong));
  const [mixed] = dataTopics(
    "fund_finance_deal",
    cardData({ ownership: rounds(["05/2021", "2019-03"]) }),
  );
  assert.equal(mixed!.answer, "Seneste runde er R2, 2019 på 1 mio. DKK.");
  assert.ok(mixed!.bars.some((bar) => bar.label === "R1, 05/2021"));
});

test("nothing found, an own specialist or an old run gives no data card", () => {
  assert.deepEqual(dataTopics("people_team", null), []);
  assert.deepEqual(dataTopics("people_team", cardData({})), []);
  assert.deepEqual(dataTopics("own_specialist_1", cardData({ team })), []);
  assert.deepEqual(dataTopics("fund_finance_deal", cardData({})), []);
});

test("English", () => {
  const [topic] = dataTopics("people_team", cardData({ team }), "en");
  assert.equal(topic!.headline, "2 people");
  assert.match(topic!.found[0]!, /^Jeppe Rindom, CEO: strongest on .+ \(9\/10\)\.$/);
});

test("data keys are valid sub-page addresses and never a finding category", () => {
  assert.equal(parseDeepFocus(analysisFocusKey("data_ownership")), "analyse-data_ownership");
  assert.ok(isDataTopicKey("data_team"));
  assert.ok(!isDataTopicKey("team_quality"));
});

test("amounts", () => {
  assert.equal(amountText(1_250_000_000, "EUR", "da"), "1,3 mia. EUR");
  assert.equal(amountText(850_000, "DKK", "da"), "850.000 DKK");
  assert.equal(amountText(0, null, "da"), "0");
});
