/** Tests of "Tilpasset" and "Nulstil til standard" for criteria (batch 3). Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultCriterionDescription,
  isCustomCriterion,
  type TemplateLike,
} from "./criterion-defaults.ts";

const templates: TemplateLike[] = [
  {
    strategyType: "venture",
    criteria: [
      { key: "team", description: "Teamets erfaring og gennemslagskraft." },
      { key: "traction", description: "Betalende kunder og vækst." },
    ],
  },
  {
    strategyType: "growth",
    criteria: [
      { key: "team", description: "Ledelsens track record." },
      { key: "margin", description: "Bruttomargin og stabilitet." },
    ],
  },
];

test("a criterion with the template's text is not customised", () => {
  assert.equal(
    isCustomCriterion(
      templates,
      { key: "team", description: "Teamets erfaring og gennemslagskraft." },
      "venture",
    ),
    false,
  );
});

test("a rewritten text is customised, and the default is the template's text", () => {
  const rewritten = { key: "team", description: "Noget helt andet end standarden." };
  assert.equal(isCustomCriterion(templates, rewritten, "venture"), true);
  assert.equal(
    defaultCriterionDescription(templates, "team", "venture"),
    "Teamets erfaring og gennemslagskraft.",
  );
});

test("the fund's own investment model decides which standard text comes first", () => {
  assert.equal(defaultCriterionDescription(templates, "team", "growth"), "Ledelsens track record.");
});

test("spacing alone does not make a criterion customised", () => {
  assert.equal(
    isCustomCriterion(
      templates,
      { key: "traction", description: "  Betalende   kunder og vækst. " },
      "venture",
    ),
    false,
  );
});

test("a criterion the fund made itself has no default and is never customised", () => {
  const own = { key: "eget_kriterium", description: "Mit eget." };
  assert.equal(isCustomCriterion(templates, own, "venture"), false);
  assert.equal(defaultCriterionDescription(templates, own.key, "venture"), null);
});

test("the text of another template for the same key also counts as a standard", () => {
  assert.equal(
    isCustomCriterion(
      templates,
      { key: "team", description: "Ledelsens track record." },
      "venture",
    ),
    false,
  );
});

test("a team made before T-629 keeps its template text as the standard, and reset writes today's", () => {
  const thesis: TemplateLike[] = [
    {
      strategyType: "venture",
      criteria: [
        { key: "thesis_fit", description: "Hvor direkte casen matcher den erklærede tese." },
      ],
    },
  ];
  const earlier = {
    key: "thesis_fit",
    description:
      "Hvor direkte casen matcher fondens erklærede tese, sektorer og differentierede investeringssyn.",
  };
  assert.equal(isCustomCriterion(thesis, earlier, "venture"), false);
  assert.equal(
    defaultCriterionDescription(thesis, "thesis_fit", "venture"),
    "Hvor direkte casen matcher den erklærede tese.",
  );
  assert.equal(
    isCustomCriterion(thesis, { key: "thesis_fit", description: "Vores egen tekst." }, "venture"),
    true,
  );
});
