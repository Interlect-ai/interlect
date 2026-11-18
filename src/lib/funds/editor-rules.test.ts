/** Tests of the editing flow's pure rules (batch 3). Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GATE_BUILDER_TYPES,
  freeKey,
  gateFromBuilder,
  mergeKeptEdits,
  normalizeWeights,
  redistributeWeights,
  removeWithUndo,
  restoreItem,
  shouldAutosave,
  stepStatus,
  uniqueKey,
  weightTotal,
  weightsWithNewCriterion,
  weightsWithoutCriterion,
  withUniqueKeys,
  type EditableDraft,
  type GuideStepKey,
} from "./editor-rules.ts";

const sum = (weights: number[]) => Math.round(weights.reduce((a, b) => a + b, 0) * 10) / 10;
const withinLimits = (weights: number[]) => weights.every((w) => w >= 5 && w <= 40);

test("a slider moves one weight and the others share the rest to 100", () => {
  const next = redistributeWeights([25, 25, 25, 25], 0, 40);
  assert.equal(next[0], 40);
  assert.equal(sum(next), 100);
  assert.deepEqual(next.slice(1), [20, 20, 20]);
});

test("the others are scaled proportionally, not equally", () => {
  const next = redistributeWeights([40, 30, 20, 10], 0, 20);
  assert.equal(sum(next), 100);
  assert.ok(next[1]! > next[2]! && next[2]! > next[3]!);
  assert.ok(withinLimits(next));
});

test("a weight cannot go below 5 or above 40, and cannot starve the others", () => {
  assert.equal(redistributeWeights([25, 25, 25, 25], 0, 2)[0], 5);
  assert.equal(redistributeWeights([25, 25, 25, 25], 0, 90)[0], 40);
  const three = redistributeWeights([34, 33, 33], 0, 40);
  assert.equal(sum(three), 100);
  assert.ok(withinLimits(three));
});

test("pinned weights stay at the limit while the rest share what is left", () => {
  const next = redistributeWeights([40, 40, 10, 10], 2, 5);
  assert.equal(sum(next), 100);
  assert.ok(withinLimits(next), JSON.stringify(next));
  assert.equal(next[2], 5);
});

test("normalise gives 100 within the limits, also for odd inputs", () => {
  const next = normalizeWeights([1, 1, 1, 1, 1, 1]);
  assert.equal(sum(next), 100);
  assert.ok(withinLimits(next));
  const skewed = normalizeWeights([90, 5, 3, 2]);
  assert.equal(sum(skewed), 100);
  assert.ok(withinLimits(skewed), JSON.stringify(skewed));
});

test("too few criteria cannot meet the limits and are not clamped", () => {
  assert.deepEqual(normalizeWeights([60, 40]).map(Math.round), [60, 40]);
  assert.equal(sum(normalizeWeights([1, 1])), 100);
  assert.deepEqual(redistributeWeights([100], 0, 30), [100]);
});

test("adding a criterion gives it an equal share, removing one scales the rest up", () => {
  const added = weightsWithNewCriterion([25, 25, 25, 25]);
  assert.equal(added.length, 5);
  assert.equal(sum(added), 100);
  assert.equal(added[4], 20);
  const removed = weightsWithoutCriterion([20, 20, 20, 20, 20], 4);
  assert.equal(sum(removed), 100);
  assert.deepEqual(removed, [25, 25, 25, 25]);
  assert.equal(weightTotal([12.5, 12.5, 25, 50]), 100);
});

const draft = (overrides: Partial<EditableDraft> = {}): EditableDraft => ({
  fundName: "Testtese",
  thesis: "Vi tror på nordisk software.",
  stages: ["Seed"],
  geographies: ["Norden"],
  sectors: ["B2B software"],
  riskPosture: "Balanceret",
  fundSizeEur: null,
  ticketMinEur: null,
  ticketMaxEur: null,
  analysisThreshold: 70,
  gates: [{ key: "g1", label: "Geografi", description: "Skal ligge i Norden." }],
  criteria: [
    { key: "a", label: "Team", description: "Erfaring.", weight: 25 },
    { key: "b", label: "Marked", description: "Størrelse.", weight: 25 },
    { key: "c", label: "Traction", description: "Kunder.", weight: 25 },
    { key: "d", label: "Fit", description: "Tese.", weight: 25 },
  ],
  ...overrides,
});
const visited = new Set<GuideStepKey>(["start", "basis"]);

test("a complete draft is valid and every required step is done", () => {
  const status = stepStatus(draft(), visited);
  assert.equal(status.valid, true);
  assert.deepEqual(status.missing, []);
  assert.equal(status.done.basis && status.done.thesis && status.done.weights, true);
  assert.equal(status.done.mandate, true);
  assert.equal(status.done.publish, true);
});

test("the Screening step has nothing required: it is done once it has been opened", () => {
  assert.equal(stepStatus(draft(), visited).done.screening, false);
  assert.equal(
    stepStatus(draft(), new Set<GuideStepKey>([...visited, "screening"])).done.screening,
    true,
  );
});

test("weights outside 5-40 % or not summing to 100 block the publish with a reason", () => {
  const off = draft({
    criteria: [
      { key: "a", label: "Team", description: "x", weight: 45 },
      { key: "b", label: "Marked", description: "x", weight: 30 },
      { key: "c", label: "Traction", description: "x", weight: 20 },
    ],
  });
  const status = stepStatus(off, visited);
  assert.equal(status.valid, false);
  assert.equal(status.done.weights, false);
  assert.ok(
    status.missing.some((line) => /vægter 45 %/.test(line)),
    status.missing.join("|"),
  );
  const sumOff = stepStatus(
    draft({
      criteria: draft().criteria.map((c, i) => (i === 0 ? { ...c, weight: 20 } : c)),
    }),
    visited,
  );
  assert.equal(sumOff.valid, false);
  assert.ok(sumOff.missing.some((line) => /summe til 100/.test(line)));
});

test("missing text, empty lists and a ticket larger than the fund are named", () => {
  const status = stepStatus(
    draft({
      thesis: " ",
      stages: [],
      gates: [],
      fundSizeEur: 1_000_000,
      ticketMaxEur: 2_000_000,
      criteria: draft().criteria.map((c, i) => (i === 1 ? { ...c, description: "" } : c)),
    }),
    visited,
  );
  assert.equal(status.valid, false);
  assert.equal(status.canSave, false);
  assert.equal(status.ticketTooLarge, true);
  for (const part of ["Tese", "Stadier", "mandatregel", "navn og beskrivelse", "Ticket"]) {
    assert.ok(
      status.missing.some((line) => line.toLowerCase().includes(part.toLowerCase())),
      `${part} in ${status.missing.join("|")}`,
    );
  }
});

test("Start and the optional specialist step are done once visited", () => {
  const fresh = stepStatus(draft(), new Set<GuideStepKey>(["start"]));
  assert.equal(fresh.done.start, false);
  assert.equal(fresh.done.specialists, false);
  const seen = stepStatus(draft(), new Set<GuideStepKey>(["start", "basis", "specialists"]));
  assert.equal(seen.done.start, true);
  assert.equal(seen.done.specialists, true);
});

test("a draft without a name cannot be saved", () => {
  assert.equal(stepStatus(draft({ fundName: "  " }), visited).canSave, false);
});

test("autosave only on a step change, when the draft can be saved and has changed", () => {
  const base = {
    canSave: true,
    busy: false,
    fromStep: 1,
    toStep: 2,
    snapshot: "b",
    lastSavedSnapshot: "a",
  };
  assert.equal(shouldAutosave(base), true);
  assert.equal(shouldAutosave({ ...base, toStep: 1 }), false);
  assert.equal(shouldAutosave({ ...base, snapshot: "a" }), false);
  assert.equal(shouldAutosave({ ...base, busy: true }), false);
  assert.equal(shouldAutosave({ ...base, canSave: false }), false);
});

test("a removed gate comes back where it was, once", () => {
  const gates = [{ key: "a" }, { key: "b" }, { key: "c" }];
  const result = removeWithUndo(gates, 1)!;
  assert.deepEqual(result.items, [{ key: "a" }, { key: "c" }]);
  const sameKey = (x: { key: string }, y: { key: string }) => x.key === y.key;
  const back = restoreItem(result.items, result.removed, sameKey);
  assert.deepEqual(back, gates);
  assert.deepEqual(restoreItem(back, result.removed, sameKey), gates);
  assert.deepEqual(
    restoreItem([{ key: "a" }], { item: { key: "z" }, index: 5 }, sameKey).map((g) => g.key),
    ["a", "z"],
  );
  assert.equal(removeWithUndo(gates, 9), null);
});

test("the gate builder writes a review rule with the unknown-is-not-a-breach note", () => {
  assert.equal(GATE_BUILDER_TYPES.length, 6);
  const geography = gateFromBuilder("geography", "Norden")!;
  assert.equal(geography.treatment, "review");
  assert.match(geography.description, /Norden/);
  assert.match(geography.description, /ukendt, ikke brudt/);
  assert.equal(gateFromBuilder("ticket", "   "), null);
  const custom = gateFromBuilder("custom", "Selskabet har betalende kunder")!;
  assert.equal(custom.label, "Selskabet har betalende kunder");
  const long = gateFromBuilder("custom", "x".repeat(200))!;
  assert.ok(long.label.length <= 60);
});

test("a new rule key is lower case, starts with a letter and is not in use", () => {
  assert.equal(freeKey("Ny regel", []), "ny_regel");
  assert.equal(freeKey("Ny regel", ["ny_regel"]), "ny_regel_2");
  assert.equal(freeKey("Økonomi", []), "oekonomi");
  assert.equal(freeKey("123", []), "r_123");
  assert.match(freeKey("!!!", []), /^[a-z][a-z0-9_]*$/);
});

test("a renamed or new item gets a key no other item in the list has", () => {
  assert.equal(uniqueKey("Team", "a", ["b", "c"]), "team");
  assert.equal(uniqueKey("Team", "a", ["team"]), "team_2");
  assert.equal(uniqueKey("Team", "a", ["team", "team_2"]), "team_3");
  assert.equal(uniqueKey("!!!", "a", []), "a");
  assert.equal(uniqueKey("Café", "a", []), "cafe");
});

test("repeated keys from an import are made unique, the first keeps its key", () => {
  const fixed = withUniqueKeys([
    { key: "team", label: "Team" },
    { key: "team", label: "Team og ledelse" },
    { key: "market", label: "Marked" },
  ]);
  assert.deepEqual(
    fixed.map((item) => item.key),
    ["team", "team_og_ledelse", "market"],
  );
  assert.equal(new Set(fixed.map((item) => item.key)).size, 3);
});

test("two criteria or two rules with one key block saving and say which names collide", () => {
  const clash = stepStatus(
    draft({
      criteria: [
        { key: "a", label: "Team", description: "Erfaring.", weight: 25 },
        { key: "a", label: "Team igen", description: "Erfaring.", weight: 25 },
        { key: "c", label: "Traction", description: "Kunder.", weight: 25 },
        { key: "d", label: "Fit", description: "Tese.", weight: 25 },
      ],
    }),
    visited,
  );
  assert.equal(clash.canSave, false);
  assert.equal(clash.valid, false);
  assert.equal(clash.done.weights, false);
  assert.match(clash.keyConflicts[0]!, /Team, Team igen/);
  const gates = stepStatus(
    draft({
      gates: [
        { key: "g1", label: "Geografi", description: "Norden." },
        { key: "g1", label: "Geografi 2", description: "Europa." },
      ],
    }),
    visited,
  );
  assert.equal(gates.canSave, false);
  assert.equal(gates.done.mandate, false);
  assert.equal(stepStatus(draft(), visited).keyConflicts.length, 0);
  assert.equal(stepStatus(draft(), visited).canSave, true);
});

test("a weight outside 5-40 % keeps the weights step open even when the sum is 100", () => {
  const status = stepStatus(
    draft({
      criteria: [
        { key: "a", label: "Team", description: "Erfaring.", weight: 45 },
        { key: "b", label: "Marked", description: "Størrelse.", weight: 25 },
        { key: "c", label: "Traction", description: "Kunder.", weight: 25 },
        { key: "d", label: "Fit", description: "Tese.", weight: 5 },
      ],
    }),
    visited,
  );
  assert.equal(status.done.weights, false);
  assert.equal(status.valid, false);
});

test("a duplicate is never renamed into a key a later item already has", () => {
  const fixed = withUniqueKeys([
    { key: "geo", label: "Geografi" },
    { key: "geo", label: "Geografi" },
    { key: "geografi", label: "Geografi (basis)" },
  ]);
  assert.equal(fixed[2]!.key, "geografi");
  assert.equal(new Set(fixed.map((item) => item.key)).size, 3);
  assert.ok(withUniqueKeys([{ key: "x".repeat(120), label: "Lang" }])[0]!.key.length <= 80);
});

test("kept edits come back only for the fields the person changed", () => {
  const base = { thesis: "A", riskPosture: "Lav", analysisThreshold: 70 };
  const kept = { thesis: "A, skarpere", riskPosture: "Lav", analysisThreshold: 70 };
  const server = { thesis: "A", riskPosture: "Lav", analysisThreshold: 65 };
  assert.deepEqual(mergeKeptEdits(server, kept, base), {
    thesis: "A, skarpere",
    riskPosture: "Lav",
    analysisThreshold: 65,
  });
});

test("the rule builder writes the rule in the page's language (T-622)", () => {
  const english = gateFromBuilder("geography", "Nordics", "en")!;
  assert.equal(english.label, "Geography");
  assert.equal(
    english.description,
    "The company's headquarters or main activity must be in: Nordics. If evidence is missing, the rule is unknown, not breached.",
  );
  assert.equal(
    gateFromBuilder("geography", "Norden")!.description,
    "Selskabets hovedsæde eller primære aktivitet skal ligge i: Norden. Mangler der evidens, er reglen ukendt, ikke brudt.",
  );
});
