/** Test af mandatfit-forhåndsvisningen på Opret case. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  geographyMatches,
  previewMandate,
  previewSummary,
  stageMatches,
} from "./intake-mandate.ts";

const snapshot = {
  fundId: "f1",
  fundName: "Testfond",
  stages: ["Pre-seed", "Seed"],
  geographies: ["Danmark", "Sverige"],
  gates: [
    { key: "stage_fit", label: "Stadie" },
    { key: "geography_fit", label: "Geografi" },
    { key: "ticket_fit", label: "Ticket" },
    { key: "legal_dealbreakers", label: "Juridiske stopregler" },
  ],
};

test("kun geografi og stadie kan afgøres; resten er ukendt", () => {
  const gates = previewMandate(snapshot, { country: "Danmark", stage: "seed" });
  assert.deepEqual(
    gates.map((g) => [g.key, g.status]),
    [
      ["stage_fit", "passed"],
      ["geography_fit", "passed"],
      ["ticket_fit", "unknown"],
      ["legal_dealbreakers", "unknown"],
    ],
  );
  assert.equal(previewSummary(gates), "2 af 4 kan afgøres nu");
});

test("ukendt stadie og ukendt land giver aldrig grønt", () => {
  const gates = previewMandate(snapshot, { country: null, stage: "unknown" });
  assert.ok(gates.every((g) => g.status === "unknown"));
});

test("et land uden for tesen giver ukendt, aldrig brud", () => {
  const gates = previewMandate(snapshot, { country: "Tyskland", stage: "series_b" });
  assert.ok(gates.every((g) => g.status === "unknown"));
});

test("Norden dækker de nordiske lande", () => {
  assert.equal(geographyMatches("Norge", ["Norden"]), true);
  assert.equal(geographyMatches("Denmark", ["Nordic region"]), true);
  assert.equal(geographyMatches("Tyskland", ["Norden"]), false);
});

test("seed er ikke pre-seed, og vækst følger tesens egne ord", () => {
  assert.equal(stageMatches("seed", ["Pre-seed"]), false);
  assert.equal(stageMatches("pre_seed", ["Pre-seed"]), true);
  assert.equal(stageMatches("series_a", ["Seed", "Series A"]), true);
  assert.equal(stageMatches("growth", ["Vækst"]), true);
  assert.equal(stageMatches("growth", ["Seed"]), false);
});

test("tesens nøgler og landekoder genkendes som de gamle navne (T-964)", () => {
  assert.equal(geographyMatches("Danmark", ["DK"]), true);
  assert.equal(geographyMatches("Denmark", ["DK"]), true);
  assert.equal(geographyMatches("Norge", ["nordics"]), true);
  assert.equal(geographyMatches("Tyskland", ["nordics"]), false);
  assert.equal(geographyMatches("Sverige", ["DK", "GB"]), false);
  assert.equal(stageMatches("series_a", ["seed", "series_a"]), true);
  assert.equal(stageMatches("series_a", ["Serie A"]), true);
  assert.equal(stageMatches("series_b", ["series_b_plus"]), true);
  assert.equal(stageMatches("seed", ["pre_seed"]), false);
  assert.equal(stageMatches("later", ["later"]), true);
  assert.equal(stageMatches("growth", ["growth"]), true);
  assert.equal(stageMatches("buyout", ["buyout"]), true);
});

test("tese uden krav", () => {
  assert.equal(previewSummary([]), "Ingen krav i tesen");
});
