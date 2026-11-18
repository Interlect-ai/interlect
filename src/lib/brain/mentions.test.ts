import assert from "node:assert/strict";
import { test } from "node:test";
import { createDisplayNamer } from "../display/display-names.ts";
import { mentionMatch, mentionText } from "./mentions.ts";

const view = createDisplayNamer([
  { kind: "company", real: "Pleo", alias: "Alder Labs" },
  { kind: "company", real: "Pleo Technologies ApS", alias: "Alder Labs" },
  { kind: "person", real: "Maria Holmgaard", alias: "Ines Rasmussen" },
]);

test("without the demo view the database's match stands", () => {
  assert.equal(mentionMatch("anything", null)("Pleo"), true);
});

test("in the demo view part of an invented name finds the case (T-765 a)", () => {
  for (const typed of ["Alder", "alder l", "Labs", "Alder Labs"]) {
    assert.equal(mentionMatch(typed, view)("Pleo"), true, typed);
    assert.equal(mentionMatch(typed, view)("Pleo Technologies ApS"), true, typed);
  }
  assert.equal(mentionMatch("Ines", view)("Maria Holmgaard"), true);
});

test("in the demo view a real name typed finds nothing the screen would not show for it", () => {
  for (const typed of ["Ple", "Pleo", "Maria", "Holmgaard"]) {
    assert.equal(mentionMatch(typed, view)("Pleo"), false, typed);
    assert.equal(mentionMatch(typed, view)("Maria Holmgaard"), false, typed);
  }
});

test("in the demo view a name with no invented one is found as written", () => {
  assert.equal(mentionMatch("payments", view)("Leading payments company"), true);
  // An empty search shows the first ones, as without the demo view.
  assert.equal(mentionMatch("", view)("Pleo"), true);
});

test("the search text leaves out what means something in a pattern", () => {
  assert.equal(mentionText(" Alder (Labs), 50%_ "), "Alder  Labs   50");
  assert.equal(mentionMatch("Alder (", view)("Pleo"), true);
});
