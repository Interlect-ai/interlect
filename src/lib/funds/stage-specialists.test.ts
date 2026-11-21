/** The focus areas of a specialist in one stage ("Sådan analyserer vi"). */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOCUS_MAX,
  focusAreasOf,
  focusLabel,
  focusProblems,
  purposeOf,
  sameFoci,
  specialistTextOf,
  type SpecialistFocus,
} from "./stage-specialists.ts";

const focus = (title: string, text: string, evidence = ""): SpecialistFocus => ({
  title,
  text,
  evidence,
});

test("focusAreasOf: splits 'Name: text'; evidence follows only when the counts match", () => {
  const foci = focusAreasOf({
    mandate: ["Betalende kunder: Er der kunder, der betaler?", "Uden navn her"],
    evidenceTests: ["Kontrakter", "Fakturaer"],
    riskAreas: [],
  });
  assert.deepEqual(foci, [
    { title: "Betalende kunder", text: "Er der kunder, der betaler?", evidence: "Kontrakter" },
    { title: "", text: "Uden navn her", evidence: "Fakturaer" },
  ]);
  const unaligned = focusAreasOf({ mandate: ["A: b"], evidenceTests: ["x", "y"], riskAreas: [] });
  assert.equal(unaligned[0]!.evidence, "");
});

test("focusAreasOf: a long start is text, not a name", () => {
  const long = `${"x".repeat(70)}: rest`;
  assert.equal(focusAreasOf({ mandate: [long], evidenceTests: [], riskAreas: [] })[0]!.title, "");
});

test("specialistTextOf: one mandate line per area; evidence falls back to the mandate", () => {
  const next = specialistTextOf([focus("Team", "Hvem er holdet?"), focus("Marked", "Hvor stort?")]);
  assert.deepEqual(next.mandate, ["Team: Hvem er holdet?", "Marked: Hvor stort?"]);
  assert.deepEqual(next.evidenceTests, next.mandate);
  assert.deepEqual(next.riskAreas, ["Team", "Marked"]);
  const withEvidence = specialistTextOf([focus("Team", "a", "e1"), focus("Marked", "b", "e2")]);
  assert.deepEqual(withEvidence.evidenceTests, ["e1", "e2"]);
});

test("specialistTextOf: named risk areas stay; technical keys are replaced by the names (T-1066)", () => {
  const named = specialistTextOf([focus("Team", "a")], ["Afhængighed af stifter"]);
  assert.deepEqual(named.riskAreas, ["Afhængighed af stifter", "Team"]);
  const keys = specialistTextOf([focus("Team", "a")], ["founder_integrity"]);
  assert.deepEqual(keys.riskAreas, ["Team"]);
});

test("specialistTextOf: blank areas are dropped and lines are clipped", () => {
  const next = specialistTextOf([focus("", ""), focus("A", "b".repeat(900))]);
  assert.equal(next.mandate.length, 1);
  assert.equal(next.mandate[0]!.length, 400);
});

test("focusProblems: what keeps the areas from being saved", () => {
  assert.deepEqual(focusProblems([]), ["none"]);
  assert.deepEqual(focusProblems([], { allowEmpty: true }), []);
  assert.deepEqual(focusProblems([focus("", "x")]), []);
  assert.deepEqual(focusProblems([focus("a", " ")]), ["text"]);
  const many = Array.from({ length: FOCUS_MAX + 1 }, (_, i) => focus(`n${i}`, "t"));
  assert.deepEqual(focusProblems(many), ["tooMany"]);
  assert.deepEqual(focusProblems([focus("a", "b")]), []);
  assert.deepEqual(focusProblems([focus("Navn", "x".repeat(398))]), ["long"]);
});

test("sameFoci: ignores surrounding blanks, sees every change", () => {
  assert.equal(sameFoci([focus("a", "b")], [focus(" a ", "b ")]), true);
  assert.equal(sameFoci([focus("a", "b")], [focus("a", "c")]), false);
  assert.equal(sameFoci([focus("a", "b")], []), false);
});

test("purposeOf: always at least 10 characters (the schema wants 10+)", () => {
  assert.equal(
    purposeOf("Økonomi", [focus("Likviditet", "x"), focus("Gæld", "y")]),
    "Økonomi: Likviditet, Gæld",
  );
  assert.ok(purposeOf("Ab", [focus("C", "Meget lang tekst")]).length >= 10);
  assert.ok(purposeOf("Ab", []).length >= 10);
});

test("focusLabel: the name, else the start of the text", () => {
  assert.equal(focusLabel(focus("Team", "x")), "Team");
  assert.equal(focusLabel(focus("", "Kort tekst")), "Kort tekst");
  const long = focusLabel(
    focus(
      "",
      "Vurdér om selskabet overholder reglerne for pengevask og kundekendskab i alle markeder",
    ),
  );
  assert.ok(long.endsWith("…") && long.length <= 49);
  assert.equal(focusLabel(focus("", "")), "");
});

test("specialistTextOf: unnamed areas still give named risk areas", () => {
  const next = specialistTextOf([focus("", "Vurdér reglerne for pengevask")]);
  assert.deepEqual(next.riskAreas, ["Vurdér reglerne for pengevask"]);
});

test("evidence is kept per area; a new area does not wipe the others' evidence (review fix)", () => {
  const next = specialistTextOf([focus("A", "a", "bevis a"), focus("B", "b")]);
  assert.deepEqual(next.evidenceTests, ["bevis a", "B: b"]);
});

test("evidence copied from the mandate line follows the text; earlier area names are not kept as risks", () => {
  const stored = { mandate: ["A: gammel"], evidenceTests: ["A: gammel"], riskAreas: ["A"] };
  const before = focusAreasOf(stored);
  assert.equal(before[0]!.evidence, "");
  const edited = [{ ...before[0]!, title: "B", text: "ny" }];
  const next = specialistTextOf(edited, stored.riskAreas, before);
  assert.deepEqual(next.evidenceTests, ["B: ny"]);
  assert.deepEqual(next.riskAreas, ["B"]);
});
