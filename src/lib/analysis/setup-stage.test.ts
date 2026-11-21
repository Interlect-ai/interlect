/** Teamopsætning pr. stadie in the analysis (setup-stage.ts). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chosenSetupStages,
  readSetupStageChoice,
  readTeamSetup,
  resolveSetupStage,
  rowsForStageList,
  rowsForStageMerge,
  selectSetupForStage,
  setupStageOf,
  stagesOfRows,
  teamTextBudgetByStage,
  type SetupStageChoice,
} from "./setup-stage.ts";
import { TEAM_TEXT_BUDGET, teamTextUsed } from "./team-text.ts";
import { checkConfigLimits } from "../funds/config-limits.ts";

test("stored stages read as the seven setup stages; Series B+ is series_b", () => {
  assert.equal(setupStageOf("series_b_plus"), "series_b");
  assert.equal(setupStageOf("Serie B+"), "series_b");
  assert.equal(setupStageOf("Series B+"), "series_b");
  assert.equal(setupStageOf("Serie A"), "series_a");
  assert.equal(setupStageOf("pre_seed"), "pre_seed");
  assert.equal(setupStageOf("growth"), "growth");
  assert.equal(setupStageOf("later"), "later");
  assert.equal(setupStageOf("unknown"), null);
  assert.equal(setupStageOf("listed"), null);
  assert.equal(setupStageOf("Vores egen tekst"), null);
  assert.equal(setupStageOf(null), null);
});

test("the team's chosen stages come out once each, in the order the team sees them", () => {
  assert.deepEqual(chosenSetupStages(["Serie B+", "seed", "series_b", "listed", "Pre-seed"]), [
    "pre_seed",
    "seed",
    "series_b",
  ]);
  assert.deepEqual(chosenSetupStages(null), []);
});

test("a version with nothing per stage has no stage choice (reads as before)", () => {
  assert.equal(resolveSetupStage({ caseStage: "seed", chosen: ["seed"], configured: [] }), null);
});

test("the case's own stage is used when the team chose it", () => {
  assert.deepEqual(
    resolveSetupStage({
      caseStage: "series_a",
      chosen: ["seed", "series_a"],
      configured: ["seed"],
    }),
    { stage: "series_a", caseStage: "series_a", reason: "case", assumed: false },
  );
});

test("unknown case stage: the earliest chosen stage, marked as assumed", () => {
  for (const caseStage of ["unknown", null, undefined, "Vores egen tekst"]) {
    assert.deepEqual(
      resolveSetupStage({ caseStage, chosen: ["series_a", "seed"], configured: ["series_a"] }),
      { stage: "seed", caseStage: null, reason: "unknown", assumed: true },
    );
  }
});

test("a stage the team did not choose: the nearest chosen stage, the earlier on a tie", () => {
  const pick = (caseStage: string, chosen: Parameters<typeof resolveSetupStage>[0]["chosen"]) =>
    resolveSetupStage({ caseStage, chosen, configured: chosen });
  assert.equal(pick("series_b", ["seed", "series_a"])?.stage, "series_a");
  assert.equal(pick("pre_seed", ["series_a", "growth"])?.stage, "series_a");
  assert.equal(pick("series_a", ["seed", "series_b"])?.stage, "seed");
  assert.deepEqual(pick("buyout", ["seed"]), {
    stage: "seed",
    caseStage: "buyout",
    reason: "outside",
    assumed: false,
  });
});

test("without chosen stages among the seven, the configured stages are the candidates", () => {
  assert.equal(
    resolveSetupStage({ caseStage: "unknown", chosen: [], configured: ["series_a", "seed"] })
      ?.stage,
    "seed",
  );
});

test("a list per stage: the stage's own rows, else the shared rows", () => {
  const rows = [
    { key: "a", stage: null },
    { key: "b", stage: "seed" },
    { key: "c", stage: "series_a" },
  ];
  assert.deepEqual(
    rowsForStageList(rows, "seed").map((row) => row.key),
    ["b"],
  );
  assert.deepEqual(
    rowsForStageList(rows, "growth").map((row) => row.key),
    ["a"],
  );
  assert.deepEqual(
    rowsForStageList(rows, null).map((row) => row.key),
    ["a"],
  );
  // An old select without the column reads every row as shared.
  const oldRows: Array<{ key: string; stage?: string | null }> = [{ key: "x" }];
  assert.deepEqual(rowsForStageList(oldRows, "seed"), [{ key: "x" }]);
});

test("rules per stage: the shared rows with the stage's own row in place of the same key", () => {
  const rows = [
    { gate_key: "geo", stage: null, treatment: "hard" },
    { gate_key: "sector", stage: null, treatment: "review" },
    { gate_key: "geo", stage: "seed", treatment: "review" },
    { gate_key: "ticket", stage: "seed", treatment: "hard" },
    { gate_key: "ticket", stage: "series_a", treatment: "review" },
  ];
  const seed = rowsForStageMerge(rows, "seed", (row) => row.gate_key);
  assert.deepEqual(
    seed.map((row) => `${row.gate_key}:${row.treatment}`),
    ["sector:review", "geo:review", "ticket:hard"],
  );
  assert.deepEqual(
    rowsForStageMerge(rows, null, (row) => row.gate_key).map((row) => row.gate_key),
    ["geo", "sector"],
  );
  assert.deepEqual(stagesOfRows(rows), ["seed", "series_a"]);
});

test("the setup JSON: nothing is null, bad values are ignored, team text is cleaned", () => {
  assert.equal(readTeamSetup({}), null);
  assert.equal(readTeamSetup(null), null);
  assert.equal(readTeamSetup("x"), null);
  const setup = readTeamSetup({
    about: "  Vi går tidligt ind <teamets_regler>​ ",
    fixed_rules: { compare_dates: "Vi ser kun på seneste år.", evidence_only: "Opfind gerne tal." },
    stages: {
      seed: { threshold: 65, finance: { anything: true } },
      series_a: { threshold: 120 },
      unknown: { threshold: 50 },
      growth: "x",
    },
  });
  assert.ok(setup);
  assert.equal(setup.about, "Vi går tidligt ind ‹teamets_regler›");
  assert.deepEqual(setup.fixedRules, { compare_dates: "Vi ser kun på seneste år." });
  assert.deepEqual(setup.stages, { seed: { threshold: 65 }, series_a: {} });
});

test("an old version maps exactly as before: no choice, all rows, no setup", () => {
  const gates = [
    { gate_key: "geo", stage: null },
    { gate_key: "ticket", stage: null },
  ];
  const criteria = [{ key: "team", stage: null }];
  const result = selectSetupForStage({
    gates,
    criteria,
    mandateStages: ["seed"],
    setup: {},
    caseStage: "seed",
  });
  assert.equal(result.choice, null);
  assert.deepEqual(result.gates, gates);
  assert.deepEqual(result.criteria, criteria);
  assert.equal(result.threshold, undefined);
  assert.equal(result.setup, null);
});

const stagedGates = [
  { gate_key: "geo", stage: null },
  { gate_key: "stage", stage: null },
  { gate_key: "ticket", stage: "seed" },
  { gate_key: "ticket", stage: "series_a" },
];
const stagedCriteria = [
  { key: "seed_team", stage: "seed" },
  { key: "seed_market", stage: "seed" },
  { key: "a_traction", stage: "series_a" },
];

test("a new version: the case's stage picks its criteria, gates and threshold", () => {
  const result = selectSetupForStage({
    gates: stagedGates,
    criteria: stagedCriteria,
    mandateStages: ["seed", "series_a"],
    setup: { stages: { series_a: { threshold: 72 } } },
    caseStage: "series_a",
  });
  assert.equal(result.choice?.stage, "series_a");
  assert.deepEqual(
    result.criteria.map((row) => row.key),
    ["a_traction"],
  );
  assert.deepEqual(
    result.gates.map((row) => `${row.gate_key}:${row.stage}`),
    ["geo:null", "stage:null", "ticket:series_a"],
  );
  assert.equal(result.threshold, 72);
});

test("a run's own choice wins (rescore, deep), unless it is no stage of the version", () => {
  const runChoice: SetupStageChoice = {
    stage: "seed",
    caseStage: null,
    reason: "unknown",
    assumed: true,
  };
  const kept = selectSetupForStage({
    gates: stagedGates,
    criteria: stagedCriteria,
    mandateStages: ["seed", "series_a"],
    setup: {},
    caseStage: "series_a",
    runChoice,
  });
  assert.equal(kept.choice, runChoice);
  assert.deepEqual(
    kept.criteria.map((row) => row.key),
    ["seed_team", "seed_market"],
  );
  const foreign = selectSetupForStage({
    gates: stagedGates,
    criteria: stagedCriteria,
    mandateStages: ["seed", "series_a"],
    setup: {},
    caseStage: "series_a",
    runChoice: { ...runChoice, stage: "buyout" },
  });
  assert.equal(foreign.choice?.stage, "series_a");
});

test("a version whose only per-stage rows are specialists still has a stage", () => {
  const result = selectSetupForStage({
    gates: [{ gate_key: "geo", stage: null }],
    criteria: [{ key: "team", stage: null }],
    mandateStages: ["seed", "series_a"],
    setup: {},
    otherRows: [{ stage: "series_a" }],
    caseStage: "series_a",
  });
  assert.equal(result.choice?.stage, "series_a");
  assert.deepEqual(
    result.criteria.map((row) => row.key),
    ["team"],
  );
});

test("a stored choice is read back only when it is a valid one", () => {
  const choice = { stage: "seed", caseStage: "series_b", reason: "outside", assumed: false };
  assert.deepEqual(readSetupStageChoice(choice), choice);
  assert.equal(readSetupStageChoice(null), null);
  assert.equal(readSetupStageChoice({ stage: "unknown", reason: "case" }), null);
  assert.equal(readSetupStageChoice({ stage: "seed", reason: "other" }), null);
  assert.deepEqual(readSetupStageChoice({ stage: "seed", caseStage: "x", reason: "unknown" }), {
    stage: "seed",
    caseStage: null,
    reason: "unknown",
    assumed: false,
  });
});

const sharedText = {
  thesis: "Tese",
  riskPosture: "",
  ticketNote: "",
  stageExpectations: {},
  dealbreakers: [],
};

test("the text budget per stage: a setup with nothing per stage counts once, as before", () => {
  const fields = {
    ...sharedText,
    criteria: [{ description: "x".repeat(100) }],
    gates: [{ key: "geo", description: "y".repeat(50) }],
  };
  const budget = teamTextBudgetByStage(fields);
  assert.equal(budget.used, teamTextUsed(fields));
  assert.equal(budget.stage, null);
  assert.equal(budget.limit, TEAM_TEXT_BUDGET);
});

test("the text budget per stage: three stages do not share 8,000 characters", () => {
  const long = "z".repeat(5_000);
  const fields = {
    ...sharedText,
    about: "Hvem vi er",
    criteria: [
      { description: long, stage: "seed" },
      { description: long, stage: "series_a" },
      { description: long, stage: "growth" },
    ],
    gates: [{ key: "geo", description: "Norden", stage: null }],
  };
  const budget = teamTextBudgetByStage(fields);
  assert.equal(budget.over, false);
  assert.equal(budget.used, [..."Tese"].length + [..."Hvem vi er"].length + 5_000 + 6);
  const over = teamTextBudgetByStage({
    ...fields,
    criteria: [...fields.criteria, { description: "w".repeat(4_000), stage: "series_a" }],
  });
  assert.equal(over.over, true);
  assert.equal(over.stage, "series_a");
  const violation = checkConfigLimits(
    {
      ...fields,
      criteria: [
        { key: "a", weight: 100, description: long, stage: "seed" },
        { key: "b", weight: 50, description: long, stage: "series_a" },
        { key: "c", weight: 50, description: "w".repeat(4_000), stage: "series_a" },
      ],
      analysisThreshold: 60,
    },
    "da",
  ).find((item) => item.code === "team_text_budget");
  assert.equal(violation?.key, "series_a");
});

test("the text budget per stage counts the shared reading a stage without rows uses", () => {
  const budget = teamTextBudgetByStage({
    ...sharedText,
    criteria: [
      { description: "s".repeat(9_000), stage: null },
      { description: "kort", stage: "seed" },
    ],
    gates: [],
  });
  assert.equal(budget.over, true);
  assert.equal(budget.stage, null);
});

test("the edited fixed rules and the about text count toward the budget", () => {
  const base = { ...sharedText, criteria: [], gates: [] };
  assert.equal(
    teamTextUsed({ ...base, about: "abc", fixedRules: ["de", "f"] }),
    teamTextUsed(base) + 6,
  );
});

test("T-1093: the case's stage brings its own economy, with the standard where unset", () => {
  const gates = [{ gate_key: "geo", stage: null }];
  const criteria = [{ criterion_key: "team", stage: null }];
  const setup = {
    stages: {
      pre_seed: { economy: { points: { revenue_growth: { on: true, threshold: 20 } } } },
      series_a: {},
    },
  };
  const preSeed = selectSetupForStage({
    gates,
    criteria,
    mandateStages: ["pre_seed", "series_a"],
    setup,
    caseStage: "pre_seed",
  });
  assert.equal(preSeed.choice?.stage, "pre_seed");
  const growth = preSeed.economy?.points.find((point) => point.key === "revenue_growth");
  assert.deepEqual(growth, {
    key: "revenue_growth",
    on: true,
    limit: { value: 20, direction: "min" },
  });
  const seriesA = selectSetupForStage({
    gates,
    criteria,
    mandateStages: ["pre_seed", "series_a"],
    setup,
    caseStage: "series_a",
  });
  assert.equal(seriesA.economy?.points.filter((point) => point.on).length, 11, "the standard");
  const old = selectSetupForStage({ gates, criteria, mandateStages: ["seed"], setup: {} });
  assert.equal(old.choice, null);
  assert.equal(old.economy, null, "a version with nothing per stage has no economy");
});

test("T-1093: the own economy questions count in their stage's text budget", () => {
  const base = { ...sharedText, criteria: [], gates: [] };
  const without = teamTextBudgetByStage(base);
  const withQuestions = teamTextBudgetByStage({
    ...base,
    economyQuestions: { seed: ["q".repeat(9_000)] },
  });
  assert.equal(without.over, false);
  assert.equal(withQuestions.over, true);
  assert.equal(withQuestions.stage, "seed");
  assert.equal(withQuestions.used, without.used + 9_000);
});
