/** Entity keys (0042 brain_normalize_name). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { companyEntityKey, normalizeEntityName } from "./keys.ts";

test("company names lose case, extra spaces and one legal suffix", () => {
  assert.equal(normalizeEntityName("  Pleo  Technologies ApS "), "pleo technologies");
  assert.equal(normalizeEntityName("Nordic Makers A/S"), "nordic makers");
  assert.equal(normalizeEntityName("Acme, Inc."), "acme");
  assert.equal(normalizeEntityName("Bolt\tEnergy   Ltd"), "bolt energy");
  assert.equal(normalizeEntityName("Ørsted Ventures"), "ørsted ventures");
});

test("only a trailing suffix is removed, and only one", () => {
  assert.equal(normalizeEntityName("ApS Holding"), "aps holding");
  assert.equal(normalizeEntityName("Lasso AS AS"), "lasso as");
  assert.equal(normalizeEntityName("Class"), "class");
});

test("empty names have no key", () => {
  assert.equal(normalizeEntityName(""), null);
  assert.equal(normalizeEntityName("   "), null);
  assert.equal(normalizeEntityName(null), null);
  assert.equal(normalizeEntityName("ApS"), "aps");
});

test("the company key prefers CVR, then domain, then the normalised name", () => {
  const id = "c1";
  assert.equal(companyEntityKey({ id, name: "Pleo ApS", cvrNumber: "12345678" }), "cvr:12345678");
  assert.equal(companyEntityKey({ id, name: "Pleo ApS", domain: " Pleo.io " }), "domain:pleo.io");
  assert.equal(companyEntityKey({ id, name: "Pleo ApS" }), "name:pleo");
  assert.equal(companyEntityKey({ id, name: "  " }), "name:c1");
});
