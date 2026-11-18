import { test } from "node:test";
import assert from "node:assert/strict";
import { criterionColors, seriesSlot, specialistColor } from "./colors.ts";
import { specialistGroups, type DeepCriterionInput } from "../cases/deep-view.ts";
import { profileRows } from "../cases/screening-view.ts";
import { SPECIALISTS } from "../funds/thesis-wizard.ts";

function deepCriterion(criterionKey: string, category: string, score: number): DeepCriterionInput {
  return {
    criterionKey,
    category,
    label: criterionKey,
    score,
    weight: 50,
    confidence: null,
    verdict: null,
    rationale: "",
    positiveDrivers: [],
    negativeDrivers: [],
    unknowns: [],
    evidenceIds: [],
  };
}

test("seriesSlot wraps around the ten series colours", () => {
  assert.equal(seriesSlot(0), "var(--series-1)");
  assert.equal(seriesSlot(9), "var(--series-10)");
  assert.equal(seriesSlot(10), "var(--series-1)");
});

test("a criterion keeps its colour from its first place, also in a filtered or re-ordered list", () => {
  const colors = criterionColors(["team", "market", "deal"], ["deal", "extra"]);
  assert.equal(colors.of("team"), "var(--series-1)");
  assert.equal(colors.of("deal"), "var(--series-3)");
  assert.equal(colors.of("extra"), "var(--series-4)");
  // Unknown keys get a stable colour from the key itself.
  assert.equal(colors.of("unknown"), criterionColors().of("unknown"));
});

test("the same criterion has the same colour in screening and deep analysis", () => {
  const screening = [
    { criterionKey: "team", label: "Team", weight: 40, score: 70 },
    { criterionKey: "market", label: "Marked", weight: 60, score: 60 },
  ];
  const deep = [
    deepCriterion("market", "market_timing", 65),
    deepCriterion("team", "team_market_fit", 72),
  ];
  const screeningColor = new Map(profileRows(screening).map((row) => [row.key, row.color]));
  const groups = specialistGroups(deep, screening, [
    { id: "people_team", title: "Team", categories: ["team_market_fit", "market_timing"] },
  ]);
  for (const row of groups.flatMap((group) => group.criteria)) {
    assert.equal(row.color, screeningColor.get(row.criterionKey), row.criterionKey);
  }
});

test("an own specialist keeps its colour when an earlier own specialist has no tab", () => {
  const groups = specialistGroups(
    [deepCriterion("c", "own_b", 50)],
    [],
    [
      { id: "own-a", title: "A", categories: ["own_a"] },
      { id: "own-b", title: "B", categories: ["own_b"] },
    ],
  );
  assert.equal(groups.find((group) => group.id === "own-b")?.color, "var(--series-4)");
});

test("Fond og deal is the same colour in Ny investeringstese and deep analysis (D14: lilla)", () => {
  const deal = SPECIALISTS.find((spec) => spec.id === "fund_finance_deal");
  assert.equal(deal?.seriesVar, specialistColor("fund_finance_deal"));
  assert.equal(deal?.seriesVar, "var(--series-7)");
});
