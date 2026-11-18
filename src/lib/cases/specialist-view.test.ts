import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpecialistSet, parseSpecialistViews } from "./specialist-view.ts";

test("a v10 packet keeps its summary and lists", () => {
  const [view] = parseSpecialistViews([
    {
      moduleId: "people_team",
      summary: "  Teamet er stærkt. Mangler en CTO.  ",
      strengths: ["Erfaring", 7, ""],
      weaknesses: ["Ingen CTO"],
      questions: ["Hvem er CTO?"],
      unknowns: ["Vesting"],
      assessments: [],
    },
  ]);
  assert.deepEqual(view, {
    moduleId: "people_team",
    summary: "Teamet er stærkt. Mangler en CTO.",
    headline: null,
    strengths: ["Erfaring"],
    weaknesses: ["Ingen CTO"],
    questions: ["Hvem er CTO?"],
    unknowns: ["Vesting"],
  });
});

test("a packet stored before v10 has no summary (null), and bad input is skipped", () => {
  const views = parseSpecialistViews([
    { moduleId: "technology_risk", strengths: ["a"] },
    { moduleId: "x", summary: null },
    { summary: "uden modul" },
    null,
    "tekst",
  ]);
  assert.equal(views.length, 2);
  assert.equal(views[0]?.summary, null);
  assert.deepEqual(views[0]?.weaknesses, []);
  assert.deepEqual(parseSpecialistViews(undefined), []);
  assert.deepEqual(parseSpecialistViews({}), []);
});

test("a run's own set of specialists is read tolerantly; older runs have none", () => {
  assert.equal(parseSpecialistSet(undefined), null);
  assert.equal(parseSpecialistSet([]), null);
  assert.deepEqual(
    parseSpecialistSet([
      { id: "people_team", kind: "standard", title: "Team", categories: ["team_market_fit"] },
      { id: "custom_impact00001", kind: "custom", title: " Impact ", categories: [] },
      { id: "", title: "Uden id" },
      { id: "x", title: "  " },
      "nonsense",
    ]),
    [
      { id: "people_team", kind: "standard", title: "Team", categories: ["team_market_fit"] },
      { id: "custom_impact00001", kind: "custom", title: "Impact", categories: [] },
    ],
  );
});

test("a v15 packet keeps its short point for the card, within two lines (T-753b, D03)", () => {
  const [view] = parseSpecialistViews([
    {
      moduleId: "people_team",
      summary: "S",
      headline: "  Stærke founders, men salget hviler på CEO alene ",
    },
  ]);
  assert.equal(view?.headline, "Stærke founders, men salget hviler på CEO alene");
  const [long] = parseSpecialistViews([
    { moduleId: "x", summary: "S", headline: "ord ".repeat(60) },
  ]);
  assert.ok((long?.headline ?? "").length <= 120);
});
