/**
 * Polen-adapteren på et rigtigt svar fra KRS' åbne API, gemt 7. okt 2026 (PKP S.A., KRS
 * 0000019193; kun selskabets afsnit, personer fjernet). Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registryNameAgrees } from "./match.ts";
import {
  findKrsNumbers,
  isValidKrsNumber,
  latestFiledPeriod,
  normalizeKrsNumber,
  parsePolishCompany,
  polandRegistry,
} from "./poland.ts";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}

test("KRS-nummer: ti cifre med nuller foran", () => {
  assert.equal(isValidKrsNumber("0000019193"), true);
  assert.equal(isValidKrsNumber("19193"), false);
  assert.equal(isValidKrsNumber("0000000000"), false);
  assert.equal(normalizeKrsNumber("KRS 19193"), "0000019193");
  assert.equal(normalizeKrsNumber("0000 019 193"), "0000019193");
  assert.equal(normalizeKrsNumber("12345678901"), null);
});

test("KRS findes i et decks eller websites tekst, kun med mærket KRS", () => {
  assert.deepEqual(
    findKrsNumbers(
      "Booksy International sp. z o.o., KRS: 0000439707, NIP 9512371530, REGON 146209840",
    ),
    ["0000439707"],
  );
  assert.deepEqual(findKrsNumbers("nr KRS 0000019193 · numer KRS 0000019193"), ["0000019193"]);
  assert.deepEqual(findKrsNumbers("KRS: 19193 · KRS 0000 439 707"), ["0000019193", "0000439707"]);
  assert.deepEqual(findKrsNumbers("KRS 00000191931234"), []);
  // NIP, REGON og telefonnumre uden mærket tæller ikke.
  assert.deepEqual(findKrsNumbers("NIP 5250000251, tel. 0000019193"), []);
});

test("udskriften: navn, hjemmeside og aktiv; likvidation og konkurs er ikke aktive", () => {
  const raw = fixture("krs-0000019193.json");
  const company = parsePolishCompany(raw);
  assert.ok(company);
  assert.equal(company.registryNumber, "0000019193");
  assert.equal(company.name, "POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA");
  assert.equal(company.website, "https://www.pkp.pl");
  assert.equal(company.active, true);
  assert.equal(company.status, "aktiv");

  const withSection6 = (section6: Record<string, unknown>) => {
    const copy = structuredClone(raw) as { odpis: { dane: { dzial6: unknown } } };
    copy.odpis.dane.dzial6 = section6;
    return parsePolishCompany(copy);
  };
  assert.equal(withSection6({ likwidacja: [{}] })?.status, "i likvidation");
  assert.equal(withSection6({ postepowanieUpadlosciowe: [{}] })?.active, false);
  assert.equal(withSection6({ polaczeniePodzialPrzeksztalcenie: [{}] })?.active, true);
  assert.equal(parsePolishCompany(null), null);
});

test("navnet passer til mærket uden den polske selskabsform", () => {
  assert.equal(
    registryNameAgrees({ brandName: "Booksy" })("BOOKSY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"),
    true,
  );
  assert.equal(registryNameAgrees({ brandName: "Booksy" })("BOOKSY SP. Z O.O."), true);
  assert.equal(registryNameAgrees({ brandName: "Booksy" })("BOOKSY S.A."), true);
  assert.equal(
    registryNameAgrees({ brandName: "Polskie Koleje Państwowe" })(
      "POLSKIE KOLEJE PAŃSTWOWE SPÓŁKA AKCYJNA",
    ),
    true,
  );
});

test("regnskaber: ikke tilgængelige, men KRS siger hvilket år der senest er indsendt", async () => {
  const raw = fixture("krs-0000019193.json");
  assert.deepEqual(latestFiledPeriod(raw), {
    period: "01.01.2025–31.12.2025",
    filedOn: "09.07.2026",
  });
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(raw), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await polandRegistry.lookupByNumber("KRS 19193"))?.registryNumber, "0000019193");
    assert.equal(
      calls[0],
      "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000019193?rejestr=P&format=json",
    );
    const result = await polandRegistry.fetchStatements("0000019193");
    assert.deepEqual(result.statements, []);
    assert.match(result.warnings[0]!, /Repozytorium Dokumentów Finansowych/);
    assert.match(result.warnings[0]!, /01\.01\.2025–31\.12\.2025 \(indsendt 09\.07\.2026\)/);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(polandRegistry.supportsNameSearch, false);
  assert.deepEqual(await polandRegistry.searchByName("PKP"), []);
});
