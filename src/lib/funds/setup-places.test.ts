/** The four places of Teamopsætning and the old guide's drafts. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SETUP_PLACES,
  changedPlaces,
  clickStartsDraft,
  parsePlace,
  placeOfStep,
  type PlaceComparable,
} from "./setup-places.ts";
import {
  LEGACY_CREATED_KEY,
  LEGACY_DRAFT_KEY,
  clearLegacyThesisDraft,
  readLegacyThesisDraft,
} from "./legacy-thesis-draft.ts";
import { initialWizardState } from "./thesis-wizard.ts";
import type { GuideStepKey } from "./editor-rules.ts";

const ALL_STEPS: GuideStepKey[] = [
  "start",
  "basis",
  "thesis",
  "weights",
  "mandate",
  "screening",
  "specialists",
  "publish",
];

test("every step of the old editor lives in exactly one place, in the old order", () => {
  const steps = SETUP_PLACES.flatMap((place) => place.steps);
  assert.deepEqual(steps, ALL_STEPS);
  assert.deepEqual(
    SETUP_PLACES.map((place) => place.key),
    ["thesis", "screening", "analysis", "publish"],
  );
});

test("a card's old step opens the place it lives in", () => {
  assert.equal(placeOfStep("basis"), "thesis");
  assert.equal(placeOfStep("weights"), "screening");
  assert.equal(placeOfStep("mandate"), "screening");
  assert.equal(placeOfStep("screening"), "screening");
  assert.equal(placeOfStep("specialists"), "analysis");
  assert.equal(placeOfStep("publish"), "publish");
  assert.equal(placeOfStep(null), "thesis");
});

test("?sted= accepts only the four places", () => {
  assert.equal(parsePlace("analysis"), "analysis");
  assert.equal(parsePlace("weights"), undefined);
  assert.equal(parsePlace(3), undefined);
  assert.equal(parsePlace(undefined), undefined);
});

const base: PlaceComparable & { screeningInstruction: string; moduleOverrides: object } = {
  fundName: "Interlect Demo",
  strategyType: "venture",
  thesis: "Nordic B2B software.",
  stages: ["seed"],
  geographies: ["nordics"],
  sectors: ["saas"],
  fundSizeEur: null,
  ticketMinEur: 100000,
  ticketMaxEur: 2000000,
  ticketNote: "",
  riskPosture: "Balanced",
  stageExpectations: { seed: "x" },
  dealbreakers: [],
  approvalMode: "partner_approval",
  analysisThreshold: 70,
  gates: [{ key: "region", label: "Region", description: "Nordics" }],
  criteria: [{ key: "team", label: "Team", description: "Founders", weight: 100 }],
  screeningInstruction: "",
  moduleOverrides: {},
};

test("an unchanged draft changes no place; key order and undefined do not count", () => {
  const draft = {
    ...base,
    ticketNote: undefined,
    stageExpectations: { seed: "x" },
  } as typeof base;
  assert.deepEqual([...changedPlaces({ ...base, ticketNote: null }, draft)], []);
});

test("each field marks the place where it is edited", () => {
  assert.deepEqual([...changedPlaces(base, { ...base, thesis: "Other" })], ["thesis"]);
  assert.deepEqual([...changedPlaces(base, { ...base, analysisThreshold: 65 })], ["screening"]);
  assert.deepEqual(
    [...changedPlaces(base, { ...base, screeningInstruction: "Focus on revenue" })],
    ["screening"],
  );
  assert.deepEqual(
    [...changedPlaces(base, { ...base, moduleOverrides: { team: { mandate: ["x"] } } })],
    ["analysis"],
  );
  assert.deepEqual([...changedPlaces(base, base, true)], ["analysis"]);
  // "Hvem er I, og hvordan tænker I?" lives in "Jeres tese"; no setup = an empty text.
  assert.deepEqual(
    [...changedPlaces(base, { ...base, setup: { about: "Operatører" } })],
    ["thesis"],
  );
  assert.deepEqual([...changedPlaces(base, { ...base, setup: { about: " " } })], []);
});

test("T-1097: the fixed rules' edits and a stage's threshold or economy are changes in Sådan screener vi", () => {
  assert.deepEqual(
    [...changedPlaces(base, { ...base, setup: { fixedRules: { evidence_labels: "Egen tekst" } } })],
    ["screening"],
  );
  assert.deepEqual(
    [...changedPlaces(base, { ...base, setup: { stages: { seed: { threshold: 80 } } } })],
    ["screening"],
  );
  assert.deepEqual([...changedPlaces(base, { ...base, setup: {} })], []);
});

test("a first version (nothing published) counts every place but publish as new", () => {
  assert.deepEqual([...changedPlaces(null, base)], ["thesis", "screening", "analysis"]);
});

test("only a click that changes something starts the draft", () => {
  assert.equal(clickStartsDraft({ tag: "BUTTON" }), true);
  assert.equal(clickStartsDraft({ tag: "button", ariaExpanded: "false" }), false);
  assert.equal(clickStartsDraft({ tag: "button", role: "tab" }), false);
  assert.equal(clickStartsDraft({ tag: "button", browse: true }), false);
  assert.equal(clickStartsDraft({ tag: "a" }), false);
  assert.equal(clickStartsDraft({ tag: "summary" }), false);
  assert.equal(clickStartsDraft({ tag: "input", type: "checkbox" }), true);
  assert.equal(clickStartsDraft({ tag: "input", type: "text" }), false);
  assert.equal(clickStartsDraft({ tag: "div", role: "switch" }), true);
  assert.equal(clickStartsDraft({ tag: "div" }), false);
});

function memoryStorage(items: Record<string, string>) {
  const map = new Map(Object.entries(items));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    removeItem: (key: string) => void map.delete(key),
    has: (key: string) => map.has(key),
  };
}

test("the old guide's answers are carried over field by field, damaged fields get the default", () => {
  const storage = memoryStorage({
    [LEGACY_DRAFT_KEY]: JSON.stringify({
      state: {
        name: "Nordic Seed",
        type: 0,
        phases: [1],
        thesis: "We back B2B founders.",
        risk: 9,
        geo: "broken",
        specialists: [true, false, "x"],
      },
      area: 12,
    }),
  });
  const draft = readLegacyThesisDraft(storage);
  assert.ok(draft.answers);
  assert.equal(draft.answers.state.name, "Nordic Seed");
  assert.equal(draft.answers.state.type, 0);
  assert.deepEqual(draft.answers.state.phases, [1]);
  assert.deepEqual(draft.answers.state.geo, []);
  assert.equal(draft.answers.state.risk, initialWizardState().risk);
  assert.deepEqual(draft.answers.state.specialists, [true, false, true, true]);
  assert.equal(draft.answers.area, 6);
  assert.equal(draft.created, null);
});

test("an untouched start or broken JSON is not a draft", () => {
  const untouched = memoryStorage({
    [LEGACY_DRAFT_KEY]: JSON.stringify({ state: initialWizardState(), area: 0 }),
  });
  assert.equal(readLegacyThesisDraft(untouched).answers, null);
  const broken = memoryStorage({ [LEGACY_DRAFT_KEY]: "{not json", [LEGACY_CREATED_KEY]: "[" });
  assert.deepEqual(readLegacyThesisDraft(broken), { answers: null, created: null });
});

test("a team the guide created is kept until it is published, then forgotten", () => {
  const unpublished = memoryStorage({
    [LEGACY_CREATED_KEY]: JSON.stringify({ fundId: "f1", configId: "c1", published: false }),
  });
  assert.deepEqual(readLegacyThesisDraft(unpublished).created, {
    fundId: "f1",
    configId: "c1",
    published: false,
  });
  const published = memoryStorage({
    [LEGACY_CREATED_KEY]: JSON.stringify({ fundId: "f1", configId: "c1", published: true }),
  });
  assert.equal(readLegacyThesisDraft(published).created, null);
});

test("clearing removes both keys", () => {
  const storage = memoryStorage({ [LEGACY_DRAFT_KEY]: "{}", [LEGACY_CREATED_KEY]: "{}" });
  clearLegacyThesisDraft(storage);
  assert.equal(storage.has(LEGACY_DRAFT_KEY), false);
  assert.equal(storage.has(LEGACY_CREATED_KEY), false);
});
