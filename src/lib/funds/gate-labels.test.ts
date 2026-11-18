import { test } from "node:test";
import assert from "node:assert/strict";
import { gateDescriptionText, gateInLanguage, gateLabelText } from "./gate-labels.ts";
import { translate } from "../i18n/translate.ts";

// "Interlect Demo" as stored on staging: English names around Danish basis names.
test("the demo team's geography and stage rules are shown in English", () => {
  assert.equal(
    gateLabelText("geography_fit", "Based in Norden, Europa", "en"),
    "Based in Nordics, Europe",
  );
  assert.equal(
    gateLabelText("stage_fit", "Stage: Seed, Serie A, Serie B", "en"),
    "Stage: Seed, Series A, Series B",
  );
  assert.equal(
    gateLabelText("ticket_fit", "Ticket 3,000,000–20,000,000 DKK", "en"),
    "Ticket 3,000,000–20,000,000 DKK",
  );
});

test("the same rules are shown in Danish, whichever language they were saved in", () => {
  assert.equal(
    gateLabelText("geography_fit", "Based in Norden, Europa", "da"),
    "Hjemme i Norden, Europa",
  );
  assert.equal(
    gateLabelText("geography_fit", "Hjemme i nordics, DK", "da"),
    "Hjemme i Norden, Danmark",
  );
  assert.equal(gateLabelText("stage_fit", "Stage: Seed, Serie A", "da"), "Fase: Seed, Series A");
  assert.equal(
    gateLabelText("ticket_fit", "Ticket 3,000,000–20,000,000 DKK", "da"),
    "Ticket 3.000.000–20.000.000 kr.",
  );
  assert.equal(
    gateLabelText("ticket_fit", "Ticket 1.000.000–5.000.000 kr.", "en"),
    "Ticket 1,000,000–5,000,000 DKK",
  );
});

test("own geographies stay as typed inside an automatic name", () => {
  assert.equal(
    gateLabelText("geography_fit", "Hjemme i Norden, Øresund", "en"),
    "Based in Nordics, Øresund",
  );
});

test("names the team wrote itself stay as written", () => {
  assert.equal(gateLabelText("geography_fit", "Only Copenhagen", "da"), "Only Copenhagen");
  assert.equal(
    gateLabelText("stage_fit", "Geography fits the mandate", "da"),
    "Geography fits the mandate",
  );
  assert.equal(gateLabelText("custom_x", "Based in Norden", "en"), "Based in Norden");
  assert.equal(gateLabelText("constructor", "Based in Norden", "en"), "Based in Norden");
});

test("the guide's explanations follow the language; own explanations stay", () => {
  const en = translate("en", "thesis.defaults.gates.stage_fit");
  const da = translate("da", "thesis.defaults.gates.stage_fit");
  assert.equal(gateDescriptionText("stage_fit", en, "da"), da);
  assert.equal(gateDescriptionText("stage_fit", da, "en"), en);
  assert.equal(gateDescriptionText("stage_fit", "Our own words.", "da"), "Our own words.");
  assert.equal(
    gateDescriptionText(
      "custom_no_hw",
      "A person must assess: No consumer hardware as the core business. If evidence is missing, the rule is unknown, not breached.",
      "da",
    ),
    translate("da", "thesis.defaults.customReview", {
      label: "No consumer hardware as the core business",
    }),
  );
});

test("a whole rule keeps its other fields", () => {
  const gate = {
    key: "stage_fit",
    label: "Stage: Serie A",
    description: "Own.",
    treatment: "hard",
  };
  assert.deepEqual(gateInLanguage(gate, "en"), { ...gate, label: "Stage: Series A" });
  const bare = { key: "stage_fit", label: "Stage: Serie A" };
  assert.deepEqual(gateInLanguage(bare, "en"), { key: "stage_fit", label: "Stage: Series A" });
});
