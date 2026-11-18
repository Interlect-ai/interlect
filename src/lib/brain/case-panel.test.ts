/** Brain-panelet på casen: de rene dele. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contradictionKey, panelDecision, rankSimilarCases } from "./case-panel.ts";

const labels = new Map([["price", "Pris for høj"]]);

test("en beslutning vises med fondens egne årsagstekster, ukendte koder som de er", () => {
  assert.deepEqual(
    panelDecision(
      { decision_kind: "reject", decided_at: "2026-03-04T10:00:00Z", reason_codes: ["price", "x"] },
      labels,
    ),
    { kind: "reject", label: "Fravalgt", decidedOn: "2026-03-04", reasons: ["Pris for høj", "x"] },
  );
});

test("ingen række, en anden slags flytning eller en dato uden tekst giver ingen beslutning", () => {
  assert.equal(panelDecision(undefined, labels), null);
  assert.equal(
    panelDecision({ decision_kind: "advance", decided_at: "2026-03-04", reason_codes: [] }, labels),
    null,
  );
  assert.equal(
    panelDecision({ decision_kind: "invest", decided_at: null, reason_codes: null }, labels),
    null,
  );
});

test("lignende cases: i søgningens rækkefølge, uden casen selv og uden dubletter, højst fem", () => {
  const entity = (n: number) => [`e${n}`, { caseId: `c${n}`, company: `Firma ${n}` }] as const;
  const byEntity = new Map([
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(entity),
    ["e9", entity(1)[1]] as const,
  ]);
  const ids = ["e3", "e0", "e9", "e1", "e2", "ukendt", "e4", "e5", "e6"];
  const ranked = rankSimilarCases(ids, byEntity, "c0");
  assert.deepEqual(
    ranked.map((row) => row.caseId),
    ["c3", "c1", "c2", "c4", "c5"],
  );
});

test("modsigelsens nøgle er den, L1 gemmer den under", () => {
  assert.equal(contradictionKey("abc"), "contradiction:evidence:abc");
});
