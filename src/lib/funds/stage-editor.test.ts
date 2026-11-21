/** What the editor reads and writes for one stage ("Sådan screener vi"). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { duplicateKeyLabels } from "./editor-rules.ts";
import {
  criteriaOf,
  economyOf,
  fixedRuleChanged,
  fixedRuleNow,
  freeKey,
  gatesOf,
  stageTabs,
  thresholdOf,
  withEconomyPoint,
  withEconomyQuestions,
  withFixedRule,
  withStageCriteria,
  withThreshold,
  withoutGate,
  patchGate,
  type StageCriterion,
  type StageGate,
} from "./stage-editor.ts";
import { fixedRuleDefault } from "./fixed-rules.ts";

const criterion = (key: string, weight: number, stage?: string): StageCriterion =>
  ({
    key,
    label: key,
    description: "d",
    category: "fund_thesis_fit",
    weight,
    ...(stage ? { stage } : {}),
  }) as StageCriterion;
const gate = (key: string, stage?: string): StageGate =>
  ({
    key,
    label: key,
    description: "d",
    treatment: "review",
    ...(stage ? { stage } : {}),
  }) as StageGate;

// A state with only what the helpers read.
const state = (extra: Record<string, unknown> = {}) =>
  ({
    stages: ["Seed", "series_b_plus", "Pre-seed", "Seed"],
    criteria: [criterion("a", 50), criterion("b", 50)],
    gates: [gate("stage_fit"), gate("own", "seed")],
    analysisThreshold: 70,
    ...extra,
  }) as never as Parameters<typeof withThreshold>[0];

test("stageTabs: each chosen stage once, in the prototype's order, with the team's own word", () => {
  const tabs = stageTabs(["Seed", "series_b_plus", "Pre-seed", "Seed", "Other words"]);
  assert.deepEqual(
    tabs.map((tab) => tab.stage),
    ["pre_seed", "seed", "series_b"],
  );
  assert.equal(tabs[2]!.raw, "series_b_plus");
});

test("criteria: a stage without rows of its own shows the shared ones; the first change copies them", () => {
  const value = state();
  assert.deepEqual(
    criteriaOf(value, "seed").map((c) => c.key),
    ["a", "b"],
  );
  const next = withStageCriteria(value, "seed", [criterion("a", 40), criterion("b", 60)]);
  assert.deepEqual(
    next.criteria.map((c) => `${c.stage ?? "shared"}:${c.key}:${c.weight}`),
    ["shared:a:50", "shared:b:50", "seed:a:40", "seed:b:60"],
  );
  // `setup` goes with rows that have a stage (the server refuses them without it).
  assert.deepEqual(next.setup, {});
  assert.deepEqual(
    criteriaOf(next, "seed").map((c) => c.weight),
    [40, 60],
  );
  // The other stage still reads the shared rows.
  assert.deepEqual(
    criteriaOf(next, "series_a").map((c) => c.weight),
    [50, 50],
  );
});

test("duplicate keys only count inside one stage", () => {
  const rows = [criterion("a", 50, "seed"), criterion("a", 50, "series_a"), criterion("b", 50)];
  assert.deepEqual(duplicateKeyLabels(rows), []);
  assert.deepEqual(duplicateKeyLabels([...rows, criterion("a", 10, "seed")]), ["a", "a"]);
});

test("rules: the shared rules with the stage's own on top; patch and remove by identity", () => {
  const value = state();
  const rules = gatesOf(value, "seed");
  assert.deepEqual(
    rules.map((rule) => rule.key),
    ["stage_fit", "own"],
  );
  const changed = patchGate(value, rules[1]!, { treatment: "hard" });
  assert.equal(gatesOf(changed, "seed")[1]!.treatment, "hard");
  assert.deepEqual(changed.setup, {});
  assert.deepEqual(
    withoutGate(changed, gatesOf(changed, "seed")[0]!).gates.map((rule) => rule.key),
    ["own"],
  );
  assert.equal(freeKey("rule", value.gates, "seed"), "rule_3");
});

test("threshold: the stage's own, else the mandate's", () => {
  const value = state();
  assert.equal(thresholdOf(value, "seed"), 70);
  const next = withThreshold(value, "seed", 83.4);
  assert.equal(thresholdOf(next, "seed"), 83);
  assert.equal(thresholdOf(next, "series_a"), 70);
  assert.equal(thresholdOf(withThreshold(value, "seed", 400), "seed"), 100);
});

test("economy: standard where nothing is saved; a point, a limit and own questions are written", () => {
  const value = state();
  assert.equal(economyOf(value, "pre_seed").points.filter((point) => point.on).length, 4);
  const on = withEconomyPoint(value, "pre_seed", "gross_margin", { on: true });
  assert.equal(economyOf(on, "pre_seed").points.filter((point) => point.on).length, 5);
  const limit = withEconomyPoint(on, "pre_seed", "gross_margin", { threshold: 55 });
  const margin = economyOf(limit, "pre_seed").points.find((point) => point.key === "gross_margin");
  assert.deepEqual(margin, {
    key: "gross_margin",
    on: true,
    limit: { value: 55, direction: "min" },
  });
  const asked = withEconomyQuestions(limit, "pre_seed", [
    { text: "  Er væksten drevet af få kunder? ", answer: "yn" },
    { text: "   ", answer: "txt" },
  ]);
  assert.deepEqual(
    economyOf(asked, "pre_seed").questions.map((question) => question.text),
    ["Er væksten drevet af få kunder?"],
  );
  // The point's choice stays when the questions are cleared.
  assert.equal(
    economyOf(withEconomyQuestions(asked, "pre_seed", []), "pre_seed").questions.length,
    0,
  );
});

test("fixed rules: an edit is stored, the standard text (or an empty one) removes it, a locked rule cannot change", () => {
  const value = state();
  assert.equal(
    fixedRuleNow(value, "evidence_labels", "da"),
    fixedRuleDefault("evidence_labels", "da"),
  );
  const edited = withFixedRule(value, "evidence_labels", "Vores egen tekst", "da");
  assert.equal(fixedRuleNow(edited, "evidence_labels", "da"), "Vores egen tekst");
  assert.equal(fixedRuleChanged(edited, "evidence_labels"), true);
  const reset = withFixedRule(
    edited,
    "evidence_labels",
    fixedRuleDefault("evidence_labels", "da"),
    "da",
  );
  assert.equal(fixedRuleChanged(reset, "evidence_labels"), false);
  assert.equal(reset.setup?.fixedRules, undefined);
  assert.equal(withFixedRule(edited, "evidence_only", "x", "da"), edited);
  assert.equal(withFixedRule(edited, "evidence_labels", "  ", "da").setup?.fixedRules, undefined);
});

test("a shared rule other than the three list rules is copied into the stage on its first change", () => {
  const value = state({ gates: [gate("stage_fit"), gate("ticket_fit")] });
  const shared = gatesOf(value, "seed")[1]!;
  const next = patchGate(value, shared, { treatment: "hard" }, "seed");
  assert.deepEqual(
    next.gates.map((rule) => `${rule.stage ?? "shared"}:${rule.key}:${rule.treatment}`),
    ["shared:stage_fit:review", "shared:ticket_fit:review", "seed:ticket_fit:hard"],
  );
  // Seed sees its own copy, another stage still the shared rule.
  assert.equal(gatesOf(next, "seed").find((rule) => rule.key === "ticket_fit")!.treatment, "hard");
  assert.equal(
    gatesOf(next, "series_a").find((rule) => rule.key === "ticket_fit")!.treatment,
    "review",
  );
  // The three list rules are the same for every stage and are changed in place.
  const listRule = gatesOf(value, "seed")[0]!;
  assert.equal(patchGate(value, listRule, { treatment: "hard" }, "seed").gates.length, 2);
});

test("a new key is never one that an undo could bring back", () => {
  const rows = [gate("a"), gate("rule_5", "seed")];
  assert.equal(freeKey("rule", rows, "seed"), "rule_6");
  assert.equal(freeKey("rule", rows, "series_a"), "rule_3");
});
