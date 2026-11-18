/** Tests of the field-by-field diff an AI proposal is shown with (batch 3). Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeFieldChanges, type ProposalDraft } from "./proposal-changes.ts";
import { diffFundConfigs } from "./config-diff.ts";

const base: ProposalDraft = {
  thesis: "Vi investerer i nordisk B2B-software.",
  riskPosture: "Balanceret",
  analysisThreshold: 70,
  stages: ["Seed"],
  geographies: ["Norden"],
  sectors: ["B2B software"],
  dealbreakers: [],
  gates: [
    { key: "geo", label: "Geografi", description: "Skal ligge i Norden.", treatment: "review" },
    { key: "own", label: "Ejerandel", description: "Mindst 10 %.", treatment: "hard" },
  ],
  criteria: [
    { key: "team", label: "Team", description: "Erfaring.", weight: 30 },
    { key: "traction", label: "Traction", description: "Kunder.", weight: 30 },
    { key: "market", label: "Marked", description: "Størrelse.", weight: 40 },
  ],
};
const clone = () => structuredClone(base);

test("no change gives no diff", () => {
  assert.deepEqual(describeFieldChanges(base, clone()), []);
});

test("a weight change shows the old value and the new one with decimal comma", () => {
  const after = clone();
  after.criteria[1]!.weight = 32.5;
  after.criteria[2]!.weight = 37.5;
  const changes = describeFieldChanges(base, after);
  assert.deepEqual(
    changes.map((c) => [c.label, c.before, c.after, c.long]),
    [
      ["Traction: vægt", "30 %", "32,5 %", false],
      ["Marked: vægt", "40 %", "37,5 %", false],
    ],
  );
});

test("a rewritten text is long and carries both the old and the new text", () => {
  const after = clone();
  after.thesis = "Vi investerer i nordisk B2B-software med betalende kunder.";
  after.criteria[1]!.description = "Betalende kunder, ikke piloter.";
  const changes = describeFieldChanges(base, after);
  assert.equal(changes.length, 2);
  assert.equal(changes[0]!.label, "Tesen");
  assert.equal(changes[0]!.before, base.thesis);
  assert.equal(changes[0]!.after, after.thesis);
  assert.equal(changes[0]!.long, true);
  assert.equal(changes[1]!.label, "Traction: hvad Interlect kigger efter");
});

test("added and removed criteria and rules are one-sided", () => {
  const after = clone();
  after.criteria.push({ key: "ip", label: "IP", description: "Patenter.", weight: 5 });
  after.criteria = after.criteria.filter((c) => c.key !== "market");
  after.gates = after.gates.filter((g) => g.key !== "own");
  after.gates.push({ key: "new", label: "Sektor", description: "x", treatment: "hard" });
  const changes = describeFieldChanges(base, after);
  const byId = new Map(changes.map((c) => [c.id, c]));
  assert.deepEqual(
    [byId.get("criterion-new-ip")!.before, byId.get("criterion-new-ip")!.after],
    [null, "5 %"],
  );
  assert.equal(byId.get("criterion-removed-market")!.after, null);
  assert.equal(byId.get("criterion-removed-market")!.before, "40 %");
  assert.equal(byId.get("gate-removed-own")!.before, "Bindende");
  assert.equal(byId.get("gate-new-new")!.after, "Bindende");
});

test("a rule that changes treatment shows Bindende and Vurdering", () => {
  const after = clone();
  after.gates[0]!.treatment = "hard";
  const [change] = describeFieldChanges(base, after);
  assert.equal(change!.before, "Vurdering");
  assert.equal(change!.after, "Bindende");
});

test("lists, threshold and risk text are covered", () => {
  const after = clone();
  after.stages = ["Seed", "Series A"];
  after.analysisThreshold = 65;
  after.riskPosture = "Høj innovationsrisiko";
  const labels = describeFieldChanges(base, after).map((c) => c.label);
  assert.deepEqual(labels, ["Risikotolerancen", "Anbefalet score for dyb analyse", "Stadier"]);
});

test("the field list and the one-line diff agree on whether anything changed", () => {
  const withTickets = (draft: ProposalDraft) => ({
    ...draft,
    ticketMinEur: null,
    ticketMaxEur: null,
  });
  const edits: Array<(draft: ProposalDraft) => void> = [
    (d) => void (d.thesis = "Ny tese."),
    (d) => void (d.criteria[0]!.weight = 35),
    (d) => void (d.gates[0]!.treatment = "hard"),
    (d) => void (d.criteria[0]!.label = "Hold"),
    (d) => void d.gates.pop(),
    (d) => void (d.analysisThreshold = 60),
  ];
  for (const edit of edits) {
    const after = clone();
    edit(after);
    assert.ok(describeFieldChanges(base, after).length > 0);
    assert.ok(diffFundConfigs(withTickets(base), withTickets(after)).length > 0);
  }
});

test("a new criterion or rule shows the text the model wrote, not only its name", () => {
  const after = clone();
  after.criteria.push({
    key: "moat",
    label: "Vollgrav",
    description: "Netværkseffekter.",
    weight: 10,
  });
  after.gates.push({
    key: "esg",
    label: "ESG",
    description: "Ingen fossil energi.",
    treatment: "hard",
  });
  const changes = describeFieldChanges(base, after);
  const text = changes.find((c) => c.id === "criterion-new-text-moat");
  assert.deepEqual(text && [text.label, text.before, text.after, text.long], [
    "Vollgrav: hvad Interlect kigger efter",
    null,
    "Netværkseffekter.",
    true,
  ]);
  const gate = changes.find((c) => c.id === "gate-new-text-esg");
  assert.equal(gate?.after, "Ingen fossil energi.");
});

test("T-861b: the screening instruction and cards are shown when both drafts have them", () => {
  const before = { ...clone(), screeningInstruction: "", screeningCards: ["finance" as const] };
  const after = {
    ...clone(),
    screeningInstruction: "Founders først.",
    screeningCards: ["finance" as const, "team" as const],
  };
  assert.deepEqual(describeFieldChanges(before, after), [
    {
      id: "screening-instruction",
      label: "Instruktion",
      before: null,
      after: "Founders først.",
      long: true,
    },
    {
      id: "screening-cards",
      label: "Ekstra screeningskort",
      before: "Finanser",
      after: "Finanser, Team",
      long: false,
    },
  ]);
  // A draft without the fields (the editor's) gives no change.
  assert.deepEqual(describeFieldChanges(clone(), after), []);
});

test("stages and geographies are compared as keys and shown by name (T-964)", () => {
  const keyed = clone();
  keyed.stages = ["seed"];
  keyed.geographies = ["nordics"];
  assert.deepEqual(describeFieldChanges(base, keyed), [], "an old name and its key are no change");
  keyed.stages = ["seed", "series_b_plus"];
  keyed.geographies = ["nordics", "DK"];
  assert.deepEqual(
    describeFieldChanges(base, keyed, "en").map((c) => [c.before, c.after]),
    [
      ["Seed", "Seed, Series B+"],
      ["Nordics", "Nordics, Denmark"],
    ],
  );
});
