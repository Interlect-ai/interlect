/**
 * Estland-adapteren på et rigtigt svar fra e-Äriregistrets autocomplete-tjeneste, gemt
 * 7. okt 2026 (Bolt Technology OÜ). Regnskabstallene kræver en aftale med RIK og er ikke med.
 * Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  estoniaRegistry,
  findEstonianRegCodes,
  isValidEstonianRegCode,
  normalizeEstonianRegCode,
  parseEstonianCompany,
} from "./estonia.ts";

const body = readFileSync(
  join(import.meta.dirname, "fixtures", "ee-autocomplete-12417834.json"),
  "utf8",
);
const row = (JSON.parse(body) as { data: Record<string, unknown>[] }).data[0]!;

test("registerkode: otte cifre med kontrolciffer", () => {
  assert.equal(isValidEstonianRegCode("12417834"), true);
  assert.equal(isValidEstonianRegCode("70000310"), true);
  assert.equal(isValidEstonianRegCode("11958539"), true);
  assert.equal(isValidEstonianRegCode("12417835"), false);
  assert.equal(isValidEstonianRegCode("1241783"), false);
  assert.equal(normalizeEstonianRegCode("1241 7834"), "12417834");
  assert.equal(normalizeEstonianRegCode("998209218"), null);
});

test("registerkode findes i tekst, kun ved et kendt mærke (ikke momsnummeret)", () => {
  assert.deepEqual(
    findEstonianRegCodes("Bolt Technology OÜ, Registry code 12417834, VAT EE101234567"),
    ["12417834"],
  );
  assert.deepEqual(findEstonianRegCodes("Registrikood: 70000310 · Reg. nr 11958539"), [
    "70000310",
    "11958539",
  ]);
  assert.deepEqual(findEstonianRegCodes("Ring 12417834 eller registry code 12417835"), []);
});

test("autocomplete: selskab med tidligere navne; ikke-aktiv status gengives", () => {
  const company = parseEstonianCompany(row);
  assert.ok(company);
  assert.equal(company.registryNumber, "12417834");
  assert.equal(company.name, "Bolt Technology OÜ");
  assert.deepEqual(company.formerNames, ["Taxify OÜ", "MTAKSO OÜ"]);
  assert.equal(company.active, true);
  const other = parseEstonianCompany({ ...row, status: "K" });
  assert.equal(other?.active, false);
  assert.match(other!.status, /statuskode K/);
  assert.equal(parseEstonianCompany({ ...row, reg_code: 12417835 }), null);
});

test("adapteren: opslag på kode og navn mod autocomplete; regnskab er ikke tilgængeligt endnu", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input instanceof Request ? input.url : input));
    return new Response(body, { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await estoniaRegistry.lookupByNumber("12417834"))?.name, "Bolt Technology OÜ");
    assert.match(calls[0]!, /q=12417834$/);
    assert.equal((await estoniaRegistry.searchByName("Bolt"))[0]?.registryNumber, "12417834");
    // Et svar for en anden kode end den spurgte giver intet selskab.
    assert.equal(await estoniaRegistry.lookupByNumber("70000310"), null);
    const result = await estoniaRegistry.fetchStatements("12417834");
    assert.deepEqual(result.statements, []);
    assert.match(result.warnings[0]!, /aftale med RIK/);
  } finally {
    globalThis.fetch = original;
  }
});
