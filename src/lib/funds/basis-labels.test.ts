import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geographyKey,
  geographyKeys,
  geographyText,
  sectorText,
  stageExpectationKeys,
  stageKey,
  stageKeys,
  stageText,
  withBasisKeys,
} from "./basis-labels.ts";

test("seed keys and codes read as Danish names", () => {
  assert.equal(stageText("pre_seed"), "Pre-seed");
  assert.equal(geographyText("DK"), "Danmark");
  assert.equal(geographyText("nordics"), "Norden");
  assert.equal(sectorText("b2b_saas"), "B2B-software");
});

test("text a user typed is shown unchanged", () => {
  assert.equal(stageText("Series A"), "Series A");
  assert.equal(geographyText("Norden"), "Norden");
  assert.equal(sectorText("B2B software"), "B2B software");
});

test("unknown keys are humanised rather than shown raw", () => {
  assert.equal(sectorText("space_tech"), "Space tech");
  assert.equal(geographyText("dach_region"), "Dach region");
});

test("an English fund sees the basis keys in English; Danish is unchanged (T-614b1)", () => {
  assert.equal(stageText("growth"), "Vækst");
  assert.equal(stageText("growth", "en"), "Growth");
  assert.equal(sectorText("climate_energy", "en"), "Climate and energy");
  assert.equal(geographyText("nordics", "en"), "Nordics");
  assert.equal(geographyText("DK", "en"), "Denmark");
  assert.equal(geographyText("DK"), "Danmark");
  assert.equal(stageText("unknown", "en"), "unknown");
});

test("every sector key in the taxonomy has a name, and acronyms keep their capitals (T-690)", () => {
  assert.equal(sectorText("software_b2b", "en"), "B2B software");
  assert.equal(sectorText("consumer_marketplace", "en"), "Consumer and marketplaces");
  assert.equal(sectorText("software_b2b"), "B2B-software");
  assert.equal(sectorText("saas_b2c_tools"), "SaaS B2C tools");
});

test("old saved names read as the neutral keys and show in the team's language (T-964)", () => {
  assert.equal(stageKey("Serie A"), "series_a");
  assert.equal(stageKey(" series a "), "series_a");
  assert.equal(stageKey("Series B+"), "series_b_plus");
  assert.equal(stageKey("Late stage"), "later");
  assert.equal(stageKey("Vækst"), "growth");
  assert.equal(stageKey("Buyout"), "buyout");
  assert.equal(stageKey("Listed"), "listed");
  assert.equal(geographyKey("Norden"), "nordics");
  assert.equal(geographyKey("Europa"), "europe");
  assert.equal(geographyKey("Globalt"), "global");
  assert.equal(geographyKey("Danmark"), "DK");
  assert.equal(geographyKey("Storbritannien"), "GB");
  assert.equal(geographyKey("Nordamerika"), "north_america");
  assert.equal(geographyKey("DACH"), "dach");
  assert.equal(stageText("Serie A", "en"), "Series A");
  assert.equal(geographyText("Norden", "en"), "Nordics");
  assert.equal(geographyText("Europa", "en"), "Europe");
  assert.equal(geographyText("Danmark", "en"), "Denmark");
  assert.equal(geographyText("nordics"), "Norden");
  assert.equal(stageText("listed"), "Børsnoteret");
  assert.equal(stageText("Late stage", "en"), "Later stage");
});

test("own text stays as typed, and unknown is never a chosen stage (T-964)", () => {
  assert.equal(stageKey("Etableret og profitabel"), "Etableret og profitabel");
  assert.equal(stageText("Etableret og profitabel", "en"), "Etableret og profitabel");
  assert.equal(geographyKey("Sydøstasien"), "Sydøstasien");
  assert.equal(stageKey("Unknown"), "Unknown");
  assert.equal(stageText("unknown", "en"), "unknown");
});

test("a setup's lists become keys once each, and the stage expectations follow them (T-964)", () => {
  assert.deepEqual(stageKeys(["Seed", "Serie A", "Series A", " "]), ["seed", "series_a"]);
  assert.deepEqual(geographyKeys(["Norden", "nordics", "Europa", "Danmark"]), [
    "nordics",
    "europe",
    "DK",
  ]);
  assert.deepEqual(stageExpectationKeys({ "Serie A": "", "Series A": "PMF", Seed: "Traction" }), {
    series_a: "PMF",
    seed: "Traction",
  });
  assert.deepEqual(
    withBasisKeys({
      name: "x",
      stages: ["Serie A"],
      geographies: ["Norden"],
      stageExpectations: { "Serie A": "PMF" },
    }),
    {
      name: "x",
      stages: ["series_a"],
      geographies: ["nordics"],
      stageExpectations: { series_a: "PMF" },
    },
  );
});
