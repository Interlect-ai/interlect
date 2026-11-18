import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConfigLimits, limitViolationsMessage } from "./config-limits.ts";

const ok = {
  criteria: [
    { key: "a", label: "Team", weight: 30 },
    { key: "b", label: "Marked", weight: 25 },
    { key: "c", label: "Traction", weight: 25 },
    { key: "d", label: "Teknologi", weight: 20 },
  ],
  gates: [{ key: "g1" }, { key: "g2" }],
  analysisThreshold: 70,
};

test("a valid configuration has no violations", () => {
  assert.deepEqual(checkConfigLimits(ok), []);
});

test("every template-like weighting inside 5-40 % that sums to 100 is accepted", () => {
  const config = {
    ...ok,
    criteria: ok.criteria.map((c, i) => ({ ...c, weight: [40, 5, 35, 20][i]! })),
  };
  assert.deepEqual(checkConfigLimits(config), []);
});

test("weights that do not sum to 100 are refused with the actual sum", () => {
  const violations = checkConfigLimits({ ...ok, criteria: ok.criteria.slice(0, 3) });
  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.code, "weight_sum");
  assert.match(violations[0]!.message, /80 %/);
});

test("an area below 5 % or above 40 % is refused and named", () => {
  const low = checkConfigLimits({
    ...ok,
    criteria: [
      { key: "a", label: "Team", weight: 4 },
      { key: "b", label: "Marked", weight: 51 },
      { key: "c", label: "Traction", weight: 45 },
    ],
  });
  assert.deepEqual(
    low.filter((v) => v.code === "weight_range").map((v) => v.key),
    ["a", "b", "c"],
  );
  assert.match(low[0]!.message, /Team/);
});

test("no criteria, duplicates and a threshold outside 0-100 are refused", () => {
  assert.equal(checkConfigLimits({ ...ok, criteria: [] })[0]?.code, "no_criteria");
  const duplicates = checkConfigLimits({
    ...ok,
    criteria: [...ok.criteria.slice(0, 3), { key: "a", label: "Team", weight: 20 }],
    gates: [{ key: "g" }, { key: "g" }],
    analysisThreshold: 120,
  });
  const codes = duplicates.map((v) => v.code);
  assert.ok(codes.includes("duplicate_criterion"));
  assert.ok(codes.includes("duplicate_gate"));
  assert.ok(codes.includes("threshold_range"));
});

test("the messages join into one sentence for the publish error", () => {
  const message = limitViolationsMessage(checkConfigLimits({ ...ok, criteria: [] }));
  assert.match(message, /scoringskriterium/);
});
