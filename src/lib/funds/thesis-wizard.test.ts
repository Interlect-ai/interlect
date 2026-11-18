import assert from "node:assert/strict";
import test from "node:test";
import { checkConfigLimits } from "./config-limits.ts";
import {
  AREAS,
  ASK_HINTS,
  ASK_PLACEHOLDERS,
  DEFAULT_CRITERIA,
  MAX_CRITERIA,
  MIN_CRITERIA,
  addCriterion,
  applyTicketPreset,
  autoGates,
  buildDraftFields,
  chatContext,
  fitWeights,
  initialWizardState,
  localizeDefaultCriteria,
  publishProblems,
  removeCriterion,
  setWeight,
  SUGGESTION_QUESTIONS,
  summaryRows,
  ticketBar,
  uniqueKey,
} from "./thesis-wizard.ts";

const template = {
  strategyType: "venture" as const,
  analysisThreshold: 70,
  stageExpectations: { "Pre-seed": "a", Seed: "b", "Series A": "c" },
};
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

test("default criteria sum to 100 and respect the fixed limits", () => {
  assert.equal(sum(DEFAULT_CRITERIA.map((c) => c.weight)), 100);
  const state = initialWizardState();
  assert.deepEqual(
    checkConfigLimits({ criteria: state.criteria, gates: [], analysisThreshold: 70 }),
    [],
  );
});

test("dragging one weight redistributes the rest and keeps 100 within 5-40", () => {
  const base = initialWizardState().criteria;
  for (const target of [0, 3, 6]) {
    for (const value of [1, 5, 20, 40, 99]) {
      const next = setWeight(base, target, value);
      assert.equal(sum(next.map((c) => c.weight)), 100, `target ${target} value ${value}`);
      for (const c of next) assert.ok(c.weight >= 5 && c.weight <= 40, `${c.label} ${c.weight}`);
    }
  }
  assert.equal(setWeight(base, 0, 30)[0]!.weight, 30);
});

test("fitWeights handles odd inputs", () => {
  assert.deepEqual(fitWeights([], null), []);
  const fitted = fitWeights([100, 100, 100], null);
  assert.equal(sum(fitted), 100);
  assert.ok(fitted.every((w) => w >= 5 && w <= 40));
});

test("adding and removing criteria keeps the sum at 100", () => {
  let criteria = initialWizardState().criteria;
  criteria = addCriterion(criteria, "Bæredygtighed");
  assert.equal(criteria.length, 8);
  assert.equal(sum(criteria.map((c) => c.weight)), 100);
  assert.ok(criteria.every((c) => c.weight >= 5 && c.weight <= 40));
  criteria = removeCriterion(criteria, 0);
  assert.equal(criteria.length, 7);
  assert.equal(sum(criteria.map((c) => c.weight)), 100);
  // Empty names and the upper limit are ignored.
  assert.equal(addCriterion(criteria, "  ").length, 7);
  let many = criteria;
  for (let i = 0; i < 30; i += 1) many = addCriterion(many, `Ekstra ${i}`);
  assert.equal(many.length, MAX_CRITERIA);
  assert.equal(sum(many.map((c) => c.weight)), 100);
  // Never fewer than the minimum.
  let few = criteria;
  for (let i = 0; i < 10; i += 1) few = removeCriterion(few, 0);
  assert.equal(few.length, MIN_CRITERIA);
  assert.equal(sum(few.map((c) => c.weight)), 100);
});

test("criterion keys stay unique", () => {
  assert.equal(uniqueKey("Team", ["team"], ""), "team_2");
  assert.equal(uniqueKey("Ingen fossil energi", [], "custom_"), "custom_ingen_fossil_energi");
  assert.equal(uniqueKey("Ældre år", [], ""), "aeldre_aar");
});

test("gates are derived from the frames and can be overridden", () => {
  const state = initialWizardState();
  assert.deepEqual(
    autoGates(state).map((g) => g.key),
    ["ticket_fit"],
  );
  state.phases = [1];
  state.geo = [1];
  state.geoExtra = ["Baltikum"];
  const gates = autoGates(state);
  assert.deepEqual(
    gates.map((g) => g.key),
    ["geography_fit", "stage_fit", "ticket_fit"],
  );
  assert.equal(gates[0]!.label, "Hjemme i Norden, Baltikum");
  assert.match(gates[2]!.label, /^Ticket 1\.000\.000–5\.000\.000 kr\.$/);
});

test("the draft passes the same limits the server checks at publish", () => {
  const state = initialWizardState();
  state.name = "Nordhav Ventures III";
  state.type = 0;
  state.phases = [0, 1, 2];
  state.geo = [1];
  state.sectors = [0, 2];
  state.thesis = "Vi investerer i klima.";
  state.gates = [
    ...autoGates(state),
    { key: "x", label: "Ingen fossil energi", icon: "ban", review: false },
    { key: "y", label: "Ingen fossil energi", icon: "ban", review: true },
  ];
  const fields = buildDraftFields(state, template);
  assert.equal(fields.strategyType, "venture");
  // Neutral keys, shown in the team's language by basis-labels.ts.
  assert.deepEqual(fields.stages, ["pre_seed", "seed", "series_a"]);
  assert.deepEqual(fields.geographies, ["nordics"]);
  assert.equal(fields.stageExpectations["series_a"], "c", "Series A text is carried over");
  assert.equal(fields.stageExpectations["pre_seed"], "a");
  assert.equal(fields.ticketMinEur, Math.round(1_000_000 / 7.46));
  const keys = fields.gates.map((g) => g.key);
  assert.equal(new Set(keys).size, keys.length, "gate keys are unique");
  assert.equal(fields.gates.find((g) => g.key === "stage_fit")?.treatment, "hard");
  assert.equal(fields.gates.at(-1)?.treatment, "review");
  assert.deepEqual(publishProblems(state, template), []);
});

test("every rule and criterion has a description, as the database requires", () => {
  const state = initialWizardState();
  state.phases = [1];
  state.geo = [1];
  state.sectors = [0];
  state.gates = [
    ...autoGates(state),
    { key: "a", label: "Ingen gambling", icon: "ban", review: false },
    { key: "b", label: "Kun solo-founders", icon: "pencil", review: true },
  ];
  state.criteria = addCriterion(state.criteria, "Bæredygtighed");
  const fields = buildDraftFields(state, template);
  for (const gate of fields.gates) assert.ok(gate.description.trim(), gate.key);
  for (const criterion of fields.criteria) assert.ok(criterion.description.trim(), criterion.key);
  assert.match(fields.gates.at(-1)!.description, /^Et menneske skal vurdere/);
  assert.match(fields.criteria.at(-1)!.description, /bæredygtighed/);
});

test("publish problems are reported in Danish", () => {
  const state = initialWizardState();
  const all = publishProblems(state, template).join(" ");
  for (const word of ["navn", "fase", "geografi", "sektor", "tese"])
    assert.match(all, new RegExp(word));
  state.name = "Ok navn";
  state.phases = [1];
  state.geo = [1];
  state.sectors = [0];
  state.thesis = "Tese.";
  state.ticketMin = "5000000";
  state.ticketMax = "1000000";
  assert.match(publishProblems(state, template).join(" "), /startbeløb/);
});

test("summary and chat context only contain what the user filled in", () => {
  const state = initialWizardState();
  const rows = summaryRows(state);
  assert.equal(rows.length, 6);
  assert.equal(rows[0]!.value, "Uden navn");
  assert.equal(rows[2]!.value, "Ingen tese endnu");
  assert.equal(rows[5]!.value, "4 specialister");
  state.customSpecialists = 1;
  assert.equal(summaryRows(state)[5]!.value, "5 specialister (heraf 1 egen)");
  state.name = "Nordhav";
  state.type = 4;
  state.other = "Venturestudie";
  assert.equal(summaryRows(state)[0]!.value, "Nordhav, Venturestudie");
  assert.equal(chatContext(state)["investor_type"], "Nordhav, Venturestudie");
});

test("ticket bar and presets follow the prototype", () => {
  const state = initialWizardState();
  const bar = ticketBar(state);
  assert.equal(bar.left, 2);
  assert.equal(bar.width, 8);
  // First click on a preset above "fra" sets "til"; the next sets "fra" again.
  const first = applyTicketPreset(state, 10_000_000, false);
  assert.deepEqual(first, { ticketMin: "1000000", ticketMax: "10000000", maxSet: true });
  const second = applyTicketPreset({ ...state, ticketMax: first.ticketMax }, 500_000, true);
  assert.equal(second.ticketMin, "500000");
  assert.equal(second.maxSet, false);
});

test("T-914: the wizard has no step for screening cards, and the review has no row for them", () => {
  assert.deepEqual(
    AREAS.map((area) => area.step),
    ["investor_type", "frames", "thesis", "weights", "dealbreakers", "expertise", "review"],
  );
  assert.equal(ASK_HINTS.length, AREAS.length - 1);
  assert.equal(ASK_PLACEHOLDERS.length, AREAS.length - 1);
  assert.equal(SUGGESTION_QUESTIONS.length, AREAS.length - 1);
  assert.ok(!summaryRows(initialWizardState()).some((row) => /kort/.test(row.value)));
});

test("an English page saves the new fund's rules, criteria and risk profile in English (T-622)", () => {
  const state = initialWizardState("en");
  state.name = "Nordhav Ventures III";
  state.type = 0;
  state.phases = [0];
  state.geo = [1];
  state.sectors = [0];
  state.thesis = "We invest in climate.";
  state.gates = [
    ...autoGates(state, "en"),
    { key: "x", label: "No fossil energy", icon: "ban", review: true },
  ];
  const fields = buildDraftFields(state, template, "en");
  assert.equal(fields.criteria.find((c) => c.key === "marked")?.label, "Market");
  assert.match(fields.riskPosture, /^Balanced:/);
  assert.match(fields.gates.find((g) => g.key === "geography_fit")!.description, /^The company/);
  // The rule's name is written with the page's words, not the stored keys.
  assert.equal(fields.gates.find((g) => g.key === "geography_fit")!.label, "Based in Nordics");
  assert.deepEqual(fields.geographies, ["nordics"]);
  assert.match(fields.gates.at(-1)!.description, /^A person must assess: No fossil energy\./);
  // Danish is unchanged.
  const danish = buildDraftFields(initialWizardState(), template);
  assert.match(danish.riskPosture, /^Balanceret:/);
});

test("untouched starting criteria follow the page's language; the team's own words stay (T-622)", () => {
  const criteria = initialWizardState().criteria.map((c) =>
    c.key === "team" ? { ...c, label: "Vores team" } : c,
  );
  const english = localizeDefaultCriteria(criteria, "en");
  assert.equal(english.find((c) => c.key === "marked")?.label, "Market");
  assert.equal(english.find((c) => c.key === "team")?.label, "Vores team");
  assert.match(english.find((c) => c.key === "team")!.description, /^The founders/);
  assert.equal(localizeDefaultCriteria(english, "en"), english, "same array when nothing changes");
  assert.equal(
    localizeDefaultCriteria(english, "da").find((c) => c.key === "marked")?.label,
    "Marked",
  );
});
