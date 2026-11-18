import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardVariants,
  criteriaVariants,
  pickDefaults,
  type VariantGroup,
} from "./card-variants.ts";

const row = (score: number | null, screeningScore: number | null = null, weight = 10) => ({
  score,
  screeningScore,
  weight,
});

test("a scored specialist always has several charts to switch between", () => {
  const one: VariantGroup = { score: 70, criteria: [row(70)] };
  const variants = criteriaVariants(one);
  assert.deepEqual(variants, ["column", "ring", "gauge"]);
  assert.ok(!variants.includes("radar"), "no radar from one axis");
  assert.ok(!variants.includes("pie"), "no pie of one slice");
});

test("radar from three scored criteria, slope only with the screening, columns up to four", () => {
  const four: VariantGroup = {
    score: 73,
    criteria: [row(68, 72), row(74, 75), row(72, 73), row(79, 78)],
  };
  assert.deepEqual(criteriaVariants(four), [
    "column",
    "bar",
    "squares",
    "radar",
    "slope",
    "ring",
    "pie",
    "gauge",
  ]);
  const seven: VariantGroup = {
    score: 60,
    criteria: Array.from({ length: 7 }, () => row(60)),
  };
  const variants = criteriaVariants(seven);
  assert.ok(!variants.includes("column") && !variants.includes("ring"));
  assert.ok(!variants.includes("slope"), "no screening, no slope");
});

test("nothing scored draws no criteria chart; the own chart comes first", () => {
  assert.deepEqual(criteriaVariants({ score: null, criteria: [row(null)] }), []);
  assert.deepEqual(cardVariants({ score: null, criteria: [] }, true), ["own"]);
  assert.equal(cardVariants({ score: 70, criteria: [row(70)] }, true)[0], "own");
});

test("defaults vary across the screen and a card with its own chart starts on it", () => {
  const all = criteriaVariants({
    score: 73,
    criteria: [row(68, 72), row(74, 75), row(72, 73), row(79, 78)],
  });
  const picks = pickDefaults([
    { variants: ["own", ...all], ownLooksLike: "radar" },
    { variants: all },
    { variants: all },
    { variants: all },
    { variants: [] },
  ]);
  assert.equal(picks[0], "own");
  assert.equal(picks[4], null);
  const criteria = picks.slice(1, 4);
  assert.equal(new Set(criteria).size, 3, `no repeats: ${criteria.join(",")}`);
  assert.ok(!criteria.includes("radar"), "the team radar is already on the screen");
});

test("when every type is used, a card still gets one", () => {
  const only = ["bar"] as const;
  assert.deepEqual(pickDefaults([{ variants: only }, { variants: only }]), ["bar", "bar"]);
});

test("an own chart of tiles gives way to a criteria chart; ring and radar come first", () => {
  const all = criteriaVariants({
    score: 73,
    criteria: [row(68, 72), row(74, 75), row(72, 73), row(79, 78)],
  });
  const picks = pickDefaults([
    { variants: ["own", ...all], ownIsTiles: true },
    { variants: ["own"], ownIsTiles: true },
    { variants: all },
  ]);
  assert.equal(picks[0], "ring");
  assert.equal(picks[1], "own", "tiles stay when there is nothing else");
  assert.equal(picks[2], "radar");
  assert.equal(
    pickDefaults([{ variants: criteriaVariants({ score: 70, criteria: [row(70)] }) }])[0],
    "ring",
  );
});
