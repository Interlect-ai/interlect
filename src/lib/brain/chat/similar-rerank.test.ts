/** The similar-cases rerank. Kør: npm test */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bareCompanyName, isNameTwin, rerankSimilar } from "./similar-rerank.ts";

const c = (name: string, sector: string | null, stage: string | null = "seed") => ({
  name,
  sector,
  stage,
});

test("without a focus case the vector order is kept", () => {
  const rows = [c("a", "x"), c("b", "y")];
  assert.deepEqual(rerankSimilar(null, rows), rows);
});

test("the same sector lifts a case a few places, but a much closer vector still wins", () => {
  const focus = { sector: "proptech", stage: "seed" };
  const rows = [
    c("twin", "fintech"),
    c("other", "fintech"),
    c("same-sector", "proptech"),
    c("far", "fintech"),
  ];
  const order = rerankSimilar(focus, rows).map((row) => row.name);
  assert.equal(order[0], "same-sector");
  const far = [
    ...Array.from({ length: 9 }, (_, i) => c(`n${i}`, "fintech")),
    c("last", "proptech"),
  ];
  assert.notEqual(rerankSimilar(focus, far)[0]?.name, "last");
});

test("equal scores keep the vector order and unknown sectors get no bonus", () => {
  const focus = { sector: null, stage: null };
  const rows = [c("a", null, null), c("b", null, null), c("c", null, null)];
  assert.deepEqual(
    rerankSimilar(focus, rows).map((row) => row.name),
    ["a", "b", "c"],
  );
});

test("bareCompanyName drops trailing parentheses and the legal form", () => {
  assert.equal(bareCompanyName("Rav Logistics (demo 35) (case)"), "rav logistics");
  assert.equal(bareCompanyName("Pleo ApS"), "pleo");
  assert.equal(bareCompanyName("Fjord Labs"), "fjord labs");
});

test("a name twin is another company with the same bare name, never the same company", () => {
  const focus = { name: "Rav Logistics (demo 59)", companyId: "c59" };
  assert.equal(isNameTwin(focus, { name: "Rav Logistics (demo 35)", companyId: "c35" }), true);
  assert.equal(isNameTwin(focus, { name: "Rav Robotics (demo 47)", companyId: "c47" }), false);
  assert.equal(isNameTwin(focus, { name: "Rav Logistics (demo 59)", companyId: "c59" }), false);
  assert.equal(isNameTwin(null, { name: "Rav Logistics", companyId: "c35" }), false);
});
