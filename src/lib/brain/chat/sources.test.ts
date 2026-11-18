import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkCitations,
  citationTrust,
  citationsFor,
  clip,
  createSourceRegistry,
  stripCitationMarkers,
  toCitation,
} from "./sources.ts";

test("samme kilde får samme nummer, og registret har et loft", () => {
  const registry = createSourceRegistry(2);
  assert.equal(registry.add({ kind: "chunk", id: "a", label: "Note" }), 1);
  assert.equal(registry.add({ kind: "fact", id: "a", label: "Faktum" }), 2);
  assert.equal(registry.add({ kind: "chunk", id: "a", label: "Note igen" }), 1);
  assert.equal(registry.add({ kind: "case", id: "c", label: "Pleo" }), null);
  assert.equal(registry.size, 2);
  assert.equal(registry.get(1)?.label, "Note");
});

test("citat-tjek: kendte numre i rækkefølge, ukendte for sig, også [1, 2]", () => {
  const registry = createSourceRegistry();
  registry.add({ kind: "chunk", id: "a", label: "A" });
  registry.add({ kind: "fact", id: "b", label: "B" });
  const check = checkCitations(
    "Først [2], så [1][2] og [1, 9]. Et link [x] tæller ikke.",
    registry,
  );
  assert.deepEqual(check.cited, [2, 1]);
  assert.deepEqual(check.unknown, [9]);
});

test("et svar uden markører har ingen citater og ingen huller", () => {
  const check = checkCitations("Det ved Brain ikke endnu.", createSourceRegistry());
  assert.deepEqual(check, { cited: [], unknown: [], invalid: [] });
});

test("tidligere svar sendes uden markører", () => {
  assert.equal(
    stripCitationMarkers("Pleo har 100 kunder [1]. Omsætningen voksede [2][3] ."),
    "Pleo har 100 kunder. Omsætningen voksede.",
  );
});

test("kun de kendte tillidsniveauer får et mærke", () => {
  assert.equal(citationTrust("official"), "verified");
  assert.equal(citationTrust("company_claim"), "company_claim");
  assert.equal(citationTrust("public_web"), "public_web");
  assert.equal(citationTrust("customer_doc"), "customer_doc");
  assert.equal(citationTrust("analysis"), null);
  assert.equal(citationTrust(null), null);
});

test("citatet får selskabets navn foran og klippes til kontraktens længder", () => {
  const registry = createSourceRegistry();
  registry.add({
    kind: "chunk",
    id: "a",
    label: "Note",
    quote: "x".repeat(3000),
    trustTier: "company_claim",
    caseId: "case-1",
    at: "2026-09-01",
    ref: "case_notes:n1",
  });
  const citation = toCitation(registry.get(1)!, new Map([["case-1", "Pleo"]]));
  assert.equal(citation.label, "Pleo · Note");
  assert.equal(citation.quote?.length, 2000);
  assert.equal(citation.trust, "company_claim");
  assert.equal(citation.ref, "case_notes:n1");
  assert.equal(citation.caseId, "case-1");
});

test("kun citerede kilder bliver citater", () => {
  const registry = createSourceRegistry();
  registry.add({ kind: "chunk", id: "a", label: "A" });
  registry.add({ kind: "fact", id: "b", label: "B" });
  const citations = citationsFor(checkCitations("Kun [2].", registry), registry);
  assert.deepEqual(
    citations.map((c) => [c.n, c.id]),
    [[2, "b"]],
  );
});

test("clip forkorter med …", () => {
  assert.equal(clip("  kort  ", 10), "kort");
  assert.equal(clip("abcdefghij", 5), "abcd…");
});

test("opdigtede mærker som [get_case-data] er ikke kilder, men [påstand fra selskabet] er tekst", () => {
  const check = checkCitations(
    "Scoren er 46,5 [get_case-data] og [kilde_3]. [påstand fra selskabet] Teamet har exit.",
    createSourceRegistry(),
  );
  assert.deepEqual(check.invalid, ["[get_case-data]", "[kilde_3]"]);
  assert.deepEqual(check.unknown, []);
});
