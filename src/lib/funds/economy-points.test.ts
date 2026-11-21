/**
 * The 15 economy points per stage (prototype Teamopsaetning v3, `fin` and `DRAFT.*.fin`).
 * Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../i18n/language.ts";
import {
  ECONOMY_GROUPS,
  ECONOMY_POINTS,
  economyGroupTitle,
  economyPointQuestion,
  economyPointShort,
  economyPointSource,
  economyPointUnit,
  MAX_OWN_ECONOMY_QUESTIONS,
  OWN_QUESTION_MAX_CHARS,
  pointsOn,
  readEconomySetup,
} from "./economy-points.ts";
import { SETUP_STAGES } from "../analysis/setup-stage.ts";

test("there are 15 points in the prototype's five groups, each key once", () => {
  assert.equal(ECONOMY_POINTS.length, 15);
  assert.equal(new Set(ECONOMY_POINTS.map((point) => point.key)).size, 15);
  assert.deepEqual(
    ECONOMY_GROUPS.map((group) => ECONOMY_POINTS.filter((point) => point.group === group).length),
    [3, 3, 2, 3, 4],
  );
});

test("every point and group has its texts in both languages; a limit has a unit", () => {
  for (const language of LANGUAGES) {
    for (const group of ECONOMY_GROUPS) assert.ok(economyGroupTitle(group, language));
    for (const point of ECONOMY_POINTS) {
      assert.ok(economyPointQuestion(point.key, language).endsWith("?"), point.key);
      assert.ok(economyPointSource(point.key, language), point.key);
      assert.ok(economyPointShort(point.key, language), point.key);
      assert.equal(Boolean(economyPointUnit(point.key, language)), "limit" in point, point.key);
    }
  }
});

test("the registry's accounts are only computed in code, never asked of the AI", () => {
  const accounts = ECONOMY_POINTS.filter((point) => point.group === "accounts");
  assert.ok(accounts.every((point) => point.source === "registry"));
  assert.ok(
    ECONOMY_POINTS.filter((point) => point.group !== "accounts").every(
      (point) => (point.source as string) !== "registry",
    ),
  );
});

test("each stage has the prototype's standard points on, with its standard limits", () => {
  const onCount = (stage: (typeof SETUP_STAGES)[number]) =>
    pointsOn(readEconomySetup(undefined, stage)).length;
  assert.equal(onCount("pre_seed"), 4);
  assert.equal(onCount("seed"), 6);
  assert.equal(onCount("series_a"), 11);
  for (const stage of ["series_b", "growth", "buyout", "later"] as const) {
    assert.equal(onCount(stage), 15, stage);
  }
  const preSeed = readEconomySetup(undefined, "pre_seed");
  assert.deepEqual(
    pointsOn(preSeed).map((point) => point.key),
    ["runway", "use_of_funds", "round_size", "founder_ownership"],
  );
  assert.deepEqual(preSeed.points.find((point) => point.key === "runway")?.limit, {
    value: 12,
    direction: "min",
  });
  assert.equal(preSeed.points.find((point) => point.key === "use_of_funds")?.limit, null);
  assert.equal(preSeed.missing, "task");
  assert.deepEqual(preSeed.questions, []);
});

test("the team's choices win; a bad value falls back to the standard", () => {
  const setup = readEconomySetup(
    {
      points: {
        revenue_growth: { on: true, threshold: 40 },
        runway: { on: false },
        gross_margin: { threshold: -5 },
        valuation_multiple: { threshold: "10" },
        cac_payback: { on: "yes", threshold: 24 },
        not_a_point: { on: true },
      },
      missing: "unknown",
    },
    "pre_seed",
  );
  const point = (key: string) => setup.points.find((item) => item.key === key)!;
  assert.deepEqual(point("revenue_growth"), {
    key: "revenue_growth",
    on: true,
    limit: { value: 40, direction: "min" },
  });
  assert.equal(point("runway").on, false);
  assert.equal(point("gross_margin").limit?.value, 60);
  assert.equal(point("valuation_multiple").limit?.value, 15);
  assert.equal(point("cac_payback").on, false, "not a boolean: the standard");
  assert.equal(point("cac_payback").limit?.value, 24);
  assert.equal(setup.points.length, 15);
  assert.equal(setup.missing, "unknown");
});

test("own questions are cleaned team text, capped, numbered, with a known answer kind", () => {
  const many = Array.from({ length: MAX_OWN_ECONOMY_QUESTIONS + 3 }, (_, index) => ({
    text: `Spørgsmål ${index + 1}?`,
    answer: "num",
  }));
  const setup = readEconomySetup(
    {
      questions: [
        { text: "  Er væksten drevet af\n få store kunder? ", answer: "yn" },
        { text: "", answer: "txt" },
        { text: "x".repeat(OWN_QUESTION_MAX_CHARS + 50), answer: "weird" },
        "not an object",
        ...many,
      ],
    },
    "seed",
  );
  assert.equal(setup.questions.length, MAX_OWN_ECONOMY_QUESTIONS);
  assert.deepEqual(setup.questions[0], {
    key: "own_1",
    text: "Er væksten drevet af få store kunder?",
    answer: "yn",
  });
  assert.equal(setup.questions[1]?.key, "own_2");
  assert.equal(setup.questions[1]?.text.length, OWN_QUESTION_MAX_CHARS);
  assert.equal(setup.questions[1]?.answer, "txt");
  assert.equal(setup.questions[2]?.text, "Spørgsmål 1?");
});

test("a stored economy that is not an object reads as the standard", () => {
  for (const raw of [null, "x", 3, []]) {
    assert.deepEqual(readEconomySetup(raw, "seed"), readEconomySetup(undefined, "seed"));
  }
});
