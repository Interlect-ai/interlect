/** Specialisttrinnet i fondsopsætningen. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { specialistModules } from "../analysis/specialist-prompts.ts";
import type { CustomSpecialistInput } from "./specialist-assist.ts";
import {
  areaList,
  cleanSpecialist,
  customSpecialistDiffs,
  emptySpecialist,
  issueAction,
  linesOf,
  listDiff,
  moduleTextProblems,
  specialistFormProblems,
  specialistSetChanges,
  STANDARD_SPECIALIST_CARDS,
  type SpecialistSetLike,
} from "./specialist-cards.ts";

const impact: CustomSpecialistInput = {
  name: "Impact og klima",
  purpose: "Vurderer, om selskabets klimaeffekt er målbar og dokumenteret.",
  mandate: ["Vurdér om CO2-reduktionen er målt med en anerkendt metode"],
  evidenceTests: ["Find en tredjepartsverificeret klimaopgørelse"],
  riskAreas: ["Greenwashing"],
  questions: [],
  deliverables: [],
  categories: ["evidence_quality"],
};

test("hvert standardmodul har et kort med tre fokuspunkter", () => {
  for (const module of specialistModules) {
    const card = STANDARD_SPECIALIST_CARDS[module.id];
    assert.ok(card, module.id);
    assert.equal(card.focus.length, 3);
  }
});

test("områderne nævnes med danske navne", () => {
  assert.equal(areaList([]), "");
  assert.equal(areaList(["team_market_fit"]), "Team-market fit");
  assert.equal(
    areaList(["founder_market_fit", "team_market_fit", "evidence_quality"]),
    "Founder-market fit, Team-market fit og Datatillid",
  );
});

test("før/efter viser fjernede punkter, hvor de stod, og nye i den nye rækkefølge", () => {
  assert.deepEqual(listDiff(["a", "b", "c"], ["a", "x", "c"]), [
    { text: "a", change: "same" },
    { text: "x", change: "added" },
    { text: "b", change: "removed" },
    { text: "c", change: "same" },
  ]);
  // Mellemrum alene er ingen ændring, og tomme punkter tæller ikke.
  assert.deepEqual(listDiff([" a  b "], ["a b", ""]), [{ text: "a b", change: "same" }]);
  assert.deepEqual(listDiff([], ["ny"]), [{ text: "ny", change: "added" }]);
});

test("en rettelse viser kun de felter, der er ændret", () => {
  const after = {
    ...impact,
    mandate: [...impact.mandate, "Vurdér om effekten skalerer med omsætningen"],
    categories: ["evidence_quality", "market_timing"] as CustomSpecialistInput["categories"],
  };
  const diffs = customSpecialistDiffs(impact, after);
  assert.deepEqual(
    diffs.map((diff) => diff.label),
    ["Mandat", "Scoreområder"],
  );
  assert.deepEqual(diffs[1]!.rows.at(-1), { text: "Marked og timing", change: "added" });
  assert.deepEqual(customSpecialistDiffs(impact, impact), []);
});

test("en tom specialist siger, hvad der mangler; en hel specialist kan gemmes", () => {
  const problems = specialistFormProblems(emptySpecialist());
  assert.ok(problems.some((line) => line.startsWith("Navn")));
  assert.ok(problems.some((line) => line.startsWith("Mandat")));
  assert.ok(!problems.some((line) => line.startsWith("Spørgsmål")));
  assert.deepEqual(specialistFormProblems(impact), []);
  // Tomme linjer i editoren tæller ikke som punkter.
  assert.deepEqual(specialistFormProblems({ ...impact, riskAreas: ["  ", "Greenwashing"] }), []);
  assert.deepEqual(linesOf("a\n\n  b \n"), ["a", "b"]);
});

test("modellens forslag erstatter punktet; kodens råd sættes aldrig ind som tekst", () => {
  const ai = { kind: "vague" as const, source: "ai" as const };
  const replaced = issueAction(impact, {
    ...ai,
    field: "mandate",
    index: 0,
    suggestion: "Vurdér CO2-reduktionen pr. solgt enhed",
  });
  assert.equal(replaced?.label, "Brug forslaget");
  assert.deepEqual(replaced?.next.mandate, ["Vurdér CO2-reduktionen pr. solgt enhed"]);
  assert.equal(
    issueAction(impact, { ...ai, field: "purpose", index: null, suggestion: "Nyt formål her" })
      ?.next.purpose,
    "Nyt formål her",
  );
  // Kodens forslag er et råd ("Slet det ene."): ingen knap, der indsætter det.
  assert.equal(
    issueAction(impact, {
      field: "mandate",
      index: 0,
      kind: "vague",
      source: "code",
      suggestion: "Skriv hvad der skal undersøges, og i hvilken kilde det kan ses.",
    }),
    null,
  );
  // En gentagelse kan slettes.
  const twice = { ...impact, riskAreas: ["Greenwashing", "Greenwashing"] };
  const removed = issueAction(twice, {
    field: "riskAreas",
    index: 1,
    kind: "duplicate",
    source: "code",
    suggestion: "Slet det ene.",
  });
  assert.equal(removed?.label, "Slet punktet");
  assert.deepEqual(removed?.next.riskAreas, ["Greenwashing"]);
  // Et forslag til hele listen, et punkt der er væk, samme tekst, scoreområder og intet forslag.
  assert.equal(
    issueAction(impact, { ...ai, field: "riskAreas", index: null, suggestion: "Regulering" }),
    null,
  );
  assert.equal(issueAction(impact, { ...ai, field: "mandate", index: 4, suggestion: "x y" }), null);
  assert.equal(
    issueAction(impact, { ...ai, field: "riskAreas", index: 0, suggestion: "Greenwashing" }),
    null,
  );
  assert.equal(
    issueAction(impact, { ...ai, field: "categories", index: null, suggestion: "x" }),
    null,
  );
  assert.equal(issueAction(impact, { ...ai, field: "mandate", index: 0, suggestion: null }), null);
});

test("en standardspecialists tekst holder serverens grænser", () => {
  const ok = { mandate: ["a"], evidenceTests: ["b"], riskAreas: ["c"] };
  assert.deepEqual(moduleTextProblems(ok), []);
  assert.deepEqual(moduleTextProblems({ ...ok, riskAreas: [] }), [
    "Risikoområder: 1-12 punkter, højst 120 tegn hver",
  ]);
  assert.equal(moduleTextProblems({ ...ok, mandate: new Array(13).fill("x") }).length, 1);
  assert.equal(moduleTextProblems({ ...ok, riskAreas: ["x".repeat(121)] }).length, 1);
});

test("scoreområderne står altid i fast rækkefølge", () => {
  assert.deepEqual(
    cleanSpecialist({ ...impact, categories: ["evidence_quality", "founder_market_fit"] })
      .categories,
    ["founder_market_fit", "evidence_quality"],
  );
});

test("udgiv-listen nævner slåede fra, nye, ændrede og fjernede specialister", () => {
  const standard = specialistModules.map((module) => ({
    id: module.id,
    title: module.title,
    enabled: true,
  }));
  const before: SpecialistSetLike = {
    standard,
    custom: [
      { ...impact, key: "custom_aaaaaaaa", enabled: true },
      { ...impact, name: "Regulering", key: "custom_bbbbbbbb", enabled: true },
    ],
  };
  const after: SpecialistSetLike = {
    standard: standard.map((module) =>
      module.id === "technology_risk" ? { ...module, enabled: false } : module,
    ),
    custom: [
      { ...impact, riskAreas: ["Greenwashing", "Data"], key: "custom_aaaaaaaa", enabled: false },
      { ...impact, name: "Fødevarer", key: "custom_cccccccc", enabled: true },
    ],
  };
  assert.deepEqual(specialistSetChanges(before, after), [
    "Teknologi og IP er slået fra",
    "Impact og klima er slået fra",
    "Impact og klima er ændret",
    "Ny egen specialist: Fødevarer",
    "Egen specialist fjernet: Regulering",
  ]);
  assert.deepEqual(specialistSetChanges(before, before), []);
});
