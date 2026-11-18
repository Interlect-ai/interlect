import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardDataJsonSchema,
  cardDataPromptSection,
  readDeepCardData,
  sanitizeCardData,
  withSanitizedCardData,
  cardDataResearchQuestion,
  type CardData,
} from "./card-data.ts";
import { specialistOutputSchema } from "./specialist.contracts.ts";

const allowed = new Set(["ev-1", "ev-2"]);

test("a card point without an allowed source is dropped, never guessed (T-751)", () => {
  const team = sanitizeCardData(
    {
      kind: "team",
      people: [
        {
          name: "A. Founder",
          role: "CEO",
          scores: { domain: 8, execution: 7, commercial: 6, technical: null, leadership: 7 },
          evidenceIds: ["ev-1", "ev-1"],
        },
        {
          name: "Ukendt",
          role: "CTO",
          scores: { domain: 5, execution: 5, commercial: 5, technical: 9, leadership: 5 },
          evidenceIds: ["ev-9"],
        },
      ],
      notFound: null,
    },
    allowed,
  );
  assert.equal(team?.kind, "team");
  if (team?.kind !== "team") return;
  assert.deepEqual(
    team.people.map((person) => [person.name, person.evidenceIds]),
    [["A. Founder", ["ev-1"]]],
  );
});

test("a person with no score on any axis is not drawn", () => {
  const team = sanitizeCardData(
    {
      kind: "team",
      people: [
        {
          name: "B",
          role: "COO",
          scores: {
            domain: null,
            execution: null,
            commercial: null,
            technical: null,
            leadership: null,
          },
          evidenceIds: ["ev-1"],
        },
      ],
      notFound: null,
    },
    allowed,
  );
  assert.equal(team?.kind === "team" && team.people.length, 0);
});

test("a market line needs two different years, sorted, first source per year kept", () => {
  const base = {
    kind: "market" as const,
    label: "Spend management",
    scope: "sam" as const,
    geography: "Europa",
    currency: "EUR",
    unit: "billion" as const,
    notFound: "Ingen kilde.",
  };
  const line = sanitizeCardData(
    {
      ...base,
      points: [
        { year: 2028, value: 9, basis: "forecast", evidenceIds: ["ev-2"] },
        { year: 2024, value: 5, basis: "actual", evidenceIds: ["ev-1"] },
        { year: 2024, value: 6, basis: "actual", evidenceIds: ["ev-2"] },
      ],
    },
    allowed,
  );
  assert.ok(line?.kind === "market");
  if (line?.kind !== "market") return;
  assert.deepEqual(
    line.points.map((point) => [point.year, point.value]),
    [
      [2024, 5],
      [2028, 9],
    ],
  );
  assert.equal(line.notFound, null, "found data clears the not-found reason");

  const single = sanitizeCardData(
    { ...base, points: [{ year: 2024, value: 5, basis: "actual", evidenceIds: ["ev-1"] }] },
    allowed,
  );
  assert.ok(single?.kind === "market" && single.points.length === 0);
  assert.equal(single?.notFound, "Ingen kilde.");
});

test("ownership over 100 % is contradictory and dropped; rounds stay", () => {
  const data = sanitizeCardData(
    {
      kind: "ownership",
      holders: [
        {
          holder: "Founder A",
          holderType: "founder",
          percent: 70,
          asOf: "2025",
          evidenceIds: ["ev-1"],
        },
        {
          holder: "Fund X",
          holderType: "investor",
          percent: 40,
          asOf: "2025",
          evidenceIds: ["ev-2"],
        },
      ],
      rounds: [
        {
          name: "Seed",
          date: "2024-03",
          amount: 2,
          currency: "EUR",
          investors: ["Fund X"],
          evidenceIds: ["ev-2"],
        },
      ],
      notFound: null,
    },
    allowed,
  );
  assert.ok(data?.kind === "ownership");
  if (data?.kind !== "ownership") return;
  assert.equal(data.holders.length, 0);
  assert.equal(data.rounds.length, 1);
});

test("a benchmark needs at least one side", () => {
  const data = sanitizeCardData(
    {
      kind: "techBenchmarks",
      items: [
        {
          metric: "Oppetid",
          unit: "%",
          company: 99.9,
          industry: 99.5,
          higherIsBetter: true,
          evidenceIds: ["ev-1"],
        },
        {
          metric: "Patenter",
          unit: "stk",
          company: null,
          industry: null,
          higherIsBetter: true,
          evidenceIds: ["ev-1"],
        },
      ],
      notFound: null,
    },
    allowed,
  );
  assert.ok(data?.kind === "techBenchmarks" && data.items.length === 1);
});

test("a figure without an industry level is kept with the company's value alone (T-768)", () => {
  const data = sanitizeCardData(
    {
      kind: "techBenchmarks",
      items: [
        {
          metric: "Oppetid",
          unit: "%",
          company: 99.9,
          industry: null,
          higherIsBetter: true,
          evidenceIds: ["ev-1"],
        },
      ],
      notFound: null,
    },
    allowed,
  );
  assert.ok(data?.kind === "techBenchmarks" && data.items.length === 1);
  assert.equal(data.items[0]?.industry, null);
});

test("the technical-card rule allows company-only figures and forbids guessing the industry (T-768)", () => {
  const rule = cardDataPromptSection("technology_risk");
  assert.match(rule, /ellers er industry null/);
  assert.match(rule, /aldrig branchens niveau/);
});

type StrictObject = { required: string[]; properties: Record<string, unknown> };

test("a standard specialist's card falls back to highlights; a team's own gets highlights (T-761)", () => {
  for (const id of ["people_team", "product_market_gtm", "technology_risk", "fund_finance_deal"]) {
    const schema = cardDataJsonSchema(id, ["ev-1"]) as { anyOf: StrictObject[] };
    assert.equal(schema.anyOf.length, 2, id);
    for (const option of schema.anyOf) {
      assert.deepEqual(option.required, Object.keys(option.properties), `${id}: strict schema`);
    }
    assert.deepEqual(
      (schema.anyOf[1]!.properties["kind"] as { const: string }).const,
      "highlights",
    );
    assert.match(cardDataPromptSection(id), /kind "highlights"/);
    assert.match(cardDataPromptSection(id), /læs først casens eget materiale/);
  }
  const own = cardDataJsonSchema("custom_abcdefgh", ["ev-1"], true) as StrictObject;
  assert.equal((own.properties["kind"] as { const: string }).const, "highlights");
  assert.deepEqual(own.required, Object.keys(own.properties));
  assert.match(cardDataPromptSection("custom_abcdefgh", true), /kind "highlights"/);
  // An unknown module that is not the team's own has no card.
  assert.equal(cardDataJsonSchema("unknown_module", ["ev-1"]), null);
  assert.equal(cardDataPromptSection("unknown_module"), "");
});

test("highlights keep only sourced, finite, distinct figures, at most six (T-761)", () => {
  const item = (label: string, value: number, ids: string[], period: string | null = "2025") => ({
    label,
    value,
    unit: "clubs",
    period,
    evidenceIds: ids,
  });
  const clean = sanitizeCardData(
    {
      kind: "highlights",
      items: [
        item("Clubs", 12000, ["ev-1"]),
        item("Clubs", 12000, ["ev-2"]),
        item("Countries", 80, ["ev-404"]),
        item("Matches", Number.NaN, ["ev-1"]),
        ...Array.from({ length: 8 }, (_, i) => item(`Figure ${i}`, i, ["ev-2"])),
      ],
      notFound: "should be cleared",
    },
    allowed,
  );
  assert.equal(clean?.kind, "highlights");
  if (clean?.kind !== "highlights") return;
  assert.equal(clean.items.length, 6);
  assert.equal(clean.items[0]!.label, "Clubs");
  assert.ok(!clean.items.some((entry) => entry.label === "Countries"));
  assert.equal(clean.notFound, null);
  const empty = sanitizeCardData(
    { kind: "highlights", items: [item("Clubs", 1, ["ev-404"])], notFound: "Nothing found." },
    allowed,
  );
  assert.equal(empty?.kind === "highlights" && empty.items.length, 0);
  assert.equal(empty?.notFound, "Nothing found.");
});

test("the run's highlights are read per specialist, also a team's own (T-761)", () => {
  const highlights = {
    kind: "highlights",
    items: [{ label: "Clubs", value: 12000, unit: "clubs", period: "2025", evidenceIds: ["ev-1"] }],
    notFound: null,
  };
  const read = readDeepCardData({
    specialists: [
      { moduleId: "product_market_gtm", cardData: highlights },
      { moduleId: "custom_abcdefgh", cardData: highlights },
      { moduleId: "technology_risk", cardData: { ...highlights, items: [] } },
    ],
  });
  assert.deepEqual(Object.keys(read.highlights).sort(), ["custom_abcdefgh", "product_market_gtm"]);
  // The market's own slot stays empty, so its chart is not drawn from the highlights.
  assert.equal(read.market.status, "not_found");
});

test("a stored packet always parses; broken card data reads as none", () => {
  const packet = {
    schemaVersion: "interlect-specialist-v1",
    moduleId: "people_team",
    caseId: "c",
    assessments: [],
    findings: [],
    risks: [],
    strengths: [],
    weaknesses: [],
    unknowns: [],
    questions: [],
    financialInputs: [],
  };
  assert.equal(specialistOutputSchema.parse(packet).cardData, undefined);
  assert.equal(
    specialistOutputSchema.parse({ ...packet, cardData: { kind: "team", people: "x" } }).cardData,
    null,
  );
});

test("readDeepCardData: found, not found with reason, and runs before T-751", () => {
  const market: CardData = {
    kind: "market",
    label: "M",
    scope: "market",
    geography: "Norden",
    currency: "DKK",
    unit: "million",
    points: [],
    notFound: "Kun ét år fundet.",
  };
  const cards = readDeepCardData({
    specialists: [
      {
        moduleId: "fund_finance_deal",
        cardData: {
          kind: "ownership",
          holders: [
            { holder: "A", holderType: "founder", percent: 60, asOf: null, evidenceIds: ["ev-1"] },
          ],
          rounds: [],
          notFound: null,
        },
      },
      { moduleId: "product_market_gtm", cardData: market },
      // A card on the wrong specialist is ignored.
      { moduleId: "technology_risk", cardData: market },
    ],
  });
  assert.equal(cards.ownership.status, "found");
  assert.equal(cards.ownership.data?.holders[0]?.percent, 60);
  assert.deepEqual(cards.market, { status: "not_found", data: null, reason: "Kun ét år fundet." });
  assert.deepEqual(cards.techBenchmarks, { status: "not_found", data: null, reason: null });
  assert.deepEqual(readDeepCardData(null).team, { status: "not_found", data: null, reason: null });
});

test("the packet helper checks sources and leaves packets without card data alone", () => {
  const packet = {
    moduleId: "technology_risk",
    cardData: {
      kind: "techBenchmarks" as const,
      items: [
        {
          metric: "Oppetid",
          unit: "%",
          company: 99.9,
          industry: 99.5,
          higherIsBetter: true,
          evidenceIds: ["ev-x"],
        },
      ],
      notFound: null,
    },
  };
  const clean = withSanitizedCardData(packet, ["ev-1"]);
  assert.ok(clean.cardData?.kind === "techBenchmarks" && clean.cardData.items.length === 0);
  const none: { moduleId: string; cardData?: CardData } = { moduleId: "custom_abcdefgh" };
  assert.equal(withSanitizedCardData(none, ["ev-1"]), none);
});

test("a long market series keeps the newest years", () => {
  const points = Array.from({ length: 10 }, (_, index) => ({
    year: 2020 + index,
    value: index,
    basis: "actual" as const,
    evidenceIds: ["ev-1"],
  }));
  const line = sanitizeCardData(
    {
      kind: "market",
      label: "M",
      scope: "market",
      geography: "EU",
      currency: "EUR",
      unit: "million",
      points,
      notFound: null,
    },
    allowed,
  );
  assert.ok(line?.kind === "market");
  if (line?.kind !== "market") return;
  assert.equal(line.points[0]?.year, 2022);
  assert.equal(line.points.at(-1)?.year, 2029);
});

test("each card has a neutral research question", () => {
  for (const id of [
    "founders_team",
    "market_competition",
    "product_technology",
    "funding_ownership",
  ]) {
    assert.ok(cardDataResearchQuestion(id), id);
  }
  assert.equal(cardDataResearchQuestion("identity_registry"), null);
});
