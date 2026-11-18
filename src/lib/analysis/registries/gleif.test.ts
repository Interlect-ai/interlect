/**
 * Tyskland, Spanien og Italien på rigtige GLEIF-svar, gemt 8. okt 2026 (CC0): søgning på
 * Celonis (DE), Wallapop (ES) og Scalapay (IT), opslag på HRB 100 (to amtsgerichte) og på
 * codice fiscale 10927360015 (Satispay, i dag Momentum S.p.A.). Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chooseRegistryMatch, comparableRegistryName, registryMatchSignals } from "./match.ts";
import {
  __test,
  germanyRegistry,
  isValidItalianFiscalCode,
  isValidLei,
  isValidSpanishCif,
  italyRegistry,
  normalizeItalianFiscalCode,
  normalizeLei,
  normalizeSpanishCif,
  parseGleifRecord,
  spainRegistry,
} from "./gleif.ts";
import { registryAdapter } from "./index.ts";
import { registryCompanyUrl, registryNumberLabel } from "./types.ts";

function records(name: string): Record<string, unknown>[] {
  const parsed = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
  return parsed["data"] as Record<string, unknown>[];
}

const context = (brandName: string) => ({
  brandName,
  discoveredName: null,
  anchoredLegalName: null,
});

test("LEI: 20 tegn med kontrolcifre (ISO 17442)", () => {
  assert.equal(isValidLei("529900DCE9HLEPY8MW24"), true);
  assert.equal(isValidLei("529900DCE9HLEPY8MW25"), false);
  assert.equal(isValidLei("529900DCE9HLEPY8MW2"), false);
  assert.equal(normalizeLei("LEI: 5299 00dc e9hl epy8 mw24"), "529900DCE9HLEPY8MW24");
  assert.equal(normalizeLei("HRB 225439"), null);
});

test("Spansk NIF for selskaber: kontrolciffer eller -bogstav efter selskabsformen", () => {
  assert.equal(isValidSpanishCif("B82827932"), true);
  assert.equal(isValidSpanishCif("A80125065"), true);
  assert.equal(isValidSpanishCif("B82827933"), false);
  // En persons NIF (DNI: 8 cifre + bogstav) er aldrig et selskab.
  assert.equal(isValidSpanishCif("12345678Z"), false);
  assert.equal(normalizeSpanishCif("ES-B 82827932"), "B82827932");
  assert.equal(normalizeSpanishCif("b-8282793-2"), "B82827932");
});

test("Italiensk codice fiscale / partita IVA: 11 cifre med kontrolciffer", () => {
  assert.equal(isValidItalianFiscalCode("10927360015"), true);
  assert.equal(isValidItalianFiscalCode("06891080480"), true);
  assert.equal(isValidItalianFiscalCode("10927360016"), false);
  assert.equal(isValidItalianFiscalCode("00000000000"), false);
  assert.equal(normalizeItalianFiscalCode("IT 10927360015"), "10927360015");
  // En persons codice fiscale (16 tegn) er aldrig et selskab.
  assert.equal(normalizeItalianFiscalCode("RSSMRA85T10A562S"), null);
});

test("Tyske registernumre findes med og uden amtsgericht, før eller efter nummeret", () => {
  const find = __test.findGermanNumbers;
  assert.deepEqual(find("Celonis SE · Sitz München · Amtsgericht München, HRB 225439"), [
    "HRB 225439, Amtsgericht München",
  ]);
  assert.deepEqual(find("Registergericht: Amtsgericht Berlin-Charlottenburg HRB 271697 B"), [
    "HRB 271697 B, Amtsgericht Berlin-Charlottenburg",
  ]);
  assert.deepEqual(find("Handelsregister: HRB 100 (AG Korbach)"), ["HRB 100, Amtsgericht Korbach"]);
  assert.deepEqual(find("HRB-Nr. 225439 · USt-IdNr. DE 123456789"), ["HRB 225439"]);
  // "AG" efter nummeret er amtsgerichtet, ikke et suffiks.
  assert.deepEqual(find("Celonis SE, HRB 225439 AG München"), ["HRB 225439, Amtsgericht München"]);
  // Telefonnumre og beløb uden mærket tæller aldrig.
  assert.deepEqual(find("Tel. +49 89 225439 · 225.439 EUR"), []);
});

test("Spanske og italienske numre og LEI'er kun ved et kendt mærke", () => {
  assert.deepEqual(__test.findSpanishNumbers("Advanced Software S.L. · CIF: B-82827932 · Madrid"), [
    "NIF B82827932",
  ]);
  assert.deepEqual(__test.findSpanishNumbers("VAT ESB82827932 · NIF B82827933"), ["NIF B82827932"]);
  assert.deepEqual(__test.findSpanishNumbers("Tel. 912345678 · B82827932"), []);
  assert.deepEqual(
    __test.findItalianNumbers("Satispay S.p.A. · P.IVA IT10927360015 · REA MI-1234567"),
    ["C.F. 10927360015"],
  );
  assert.deepEqual(__test.findItalianNumbers("Partita IVA: 10927360016 · tel 02 10927360015"), []);
  // Et andet lands momsnummer under "VAT" tæller ikke; kun "VAT IT…".
  assert.deepEqual(__test.findItalianNumbers("VAT 10927360015 · VAT IT 10927360015"), [
    "C.F. 10927360015",
  ]);
  assert.deepEqual(__test.findLeis("LEI: 529900DCE9HLEPY8MW24 · id 529900DCE9HLEPY8MW24"), [
    "529900DCE9HLEPY8MW24",
  ]);
  assert.deepEqual(__test.findLeis("token ABCDEFGHIJKLMNOPQR12"), []);
  assert.deepEqual(
    germanyRegistry.findNumbersInText("LEI 529900DCE9HLEPY8MW24 · Amtsgericht München HRB 225439"),
    ["LEI 529900DCE9HLEPY8MW24", "HRB 225439, Amtsgericht München"],
  );
});

test("Amtsgerichtet i decket passer til GLEIF's navn på retten", () => {
  assert.equal(__test.courtMatches("Berlin", "Berlin-Charlottenburg"), true);
  assert.equal(__test.courtMatches("Charlottenburg", "Berlin-Charlottenburg"), true);
  assert.equal(__test.courtMatches("Korbach", "Coburg"), false);
});

test("GLEIF-poster: kun selskaber i landets eget register, LEI som nøgle", () => {
  const celonis = records("gleif-de-search-celonis.json")
    .map((row) => parseGleifRecord(row, "DE"))
    .filter((company) => company !== null);
  // Celonis, Inc. (Delaware, RA000602) er ikke et tysk selskab.
  assert.ok(celonis.every((company) => company.registryNumber !== "984500C002FF5FB10R71"));
  const se = celonis.find((company) => company.name === "Celonis SE");
  assert.ok(se);
  assert.equal(se.registryNumber, "529900DCE9HLEPY8MW24");
  assert.equal(se.nationalNumber, "HRB 225439");
  assert.equal(se.authority, "RA000304");
  assert.equal(se.active, true);
  assert.deepEqual(se.formerNames, ["Blitz 16-602 SE"]);
  assert.equal(se.registryUrl, "https://search.gleif.org/#/record/529900DCE9HLEPY8MW24");
  // Samme post set fra et andet land tæller ikke.
  assert.equal(parseGleifRecord(records("gleif-de-search-celonis.json")[0], "IT"), null);
});

test("Navnesøgningen vælger det præcise selskab; søsterselskaber tæller ikke", () => {
  const pick = (file: string, country: "DE" | "ES" | "IT", brand: string, host: string | null) =>
    chooseRegistryMatch({
      candidates: records(file)
        .map((row) => parseGleifRecord(row, country))
        .filter((company) => company !== null),
      context: context(brand),
      websiteHost: host,
    });
  assert.equal(
    pick("gleif-de-search-celonis.json", "DE", "Celonis", null).match?.name,
    "Celonis SE",
  );
  // Wallapop SL (aktiv) vinder over Wallapop Spain SL (ophørt, og et andet navn).
  assert.equal(
    pick("gleif-es-search-wallapop.json", "ES", "Wallapop", null).match?.name,
    "WALLAPOP SL",
  );
  // Scalapay S.R.L. og Scalapay IP S.p.A.: kun den første hedder præcis "Scalapay".
  assert.equal(
    pick("gleif-it-search-scalapay.json", "IT", "Scalapay", null).match?.name,
    "SCALAPAY S.R.L.",
  );
});

test("Selskabsformer fjernes fra registrets navn, de tyske/spanske/italienske kun for de tre lande", () => {
  assert.equal(comparableRegistryName("Celonis SE", "DE"), "Celonis");
  assert.equal(comparableRegistryName("Personio SE & Co. KG", "DE"), "Personio");
  assert.equal(comparableRegistryName("Henkel AG & Co. KGaA", "DE"), "Henkel");
  assert.equal(comparableRegistryName("Acme UG (haftungsbeschränkt)", "DE"), "Acme");
  assert.equal(comparableRegistryName("WALLAPOP SL", "ES"), "WALLAPOP");
  assert.equal(
    comparableRegistryName("PSA SOFTWARE PHARMA SOLUTIONS SOCIEDAD LIMITADA", "ES"),
    "PSA SOFTWARE PHARMA SOLUTIONS",
  );
  assert.equal(comparableRegistryName("SCALAPAY S.R.L.", "IT"), "SCALAPAY");
  assert.equal(comparableRegistryName("MOMENTUM S.P.A.", "IT"), "MOMENTUM");
  // Andre lande er uændrede.
  assert.equal(comparableRegistryName("LE SPA", "FR"), "LE SPA");
  assert.equal(comparableRegistryName("Nordic Spa", "NO"), "Nordic Spa");
  assert.equal(comparableRegistryName("Pure Ag"), "Pure Ag");
});

test("Opslag på nummer: codice fiscale og HRB med to amtsgerichte", async (t) => {
  const responses: Record<string, string> = {
    "10927360015": "gleif-it-10927360015.json",
    "HRB 100": "gleif-de-hrb-100.json",
  };
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname.endsWith("/registration-authorities/RA000282")) {
      return Response.json({
        data: { attributes: { internationalOrganizationName: "Local Court Korbach" } },
      });
    }
    if (url.pathname.endsWith("/registration-authorities/RA000225")) {
      return Response.json({
        data: { attributes: { internationalOrganizationName: "Local Court Coburg" } },
      });
    }
    const file = responses[url.searchParams.get("filter[entity.registeredAs]") ?? ""];
    if (!file) return Response.json({ data: [] });
    return new Response(readFileSync(join(import.meta.dirname, "fixtures", file)));
  });
  const satispay = await italyRegistry.lookupByNumber("C.F. 10927360015");
  assert.equal(satispay?.name, "MOMENTUM S.P.A.");
  assert.deepEqual(satispay?.formerNames, ["SATISPAY S.P.A."]);
  // HRB 100 findes ved to retter: uden ret vælges intet, med retten vælges den rigtige.
  assert.equal(await germanyRegistry.lookupByNumber("HRB 100"), null);
  const korbach = await germanyRegistry.lookupByNumber("HRB 100, Amtsgericht Korbach");
  assert.equal(korbach?.name, "horizont group gmbh");
  // En ret, der ikke passer til nogen af dem, giver intet.
  assert.equal(await germanyRegistry.lookupByNumber("HRB 100, Amtsgericht Hamburg"), null);
  assert.ok(calls.every((url) => url.startsWith("https://api.gleif.org/api/v1/")));
});

test("Regnskabstal er 'ikke tilgængelige i registret' for alle tre lande (D19)", async () => {
  for (const adapter of [germanyRegistry, spainRegistry, italyRegistry]) {
    const result = await adapter.fetchStatements("529900DCE9HLEPY8MW24");
    assert.deepEqual(result.statements, []);
    assert.match(result.warnings[0] ?? "", /D19/);
  }
});

test("Landene er koblet på adapter-laget og vises med LEI og GLEIF-link", () => {
  for (const country of ["DE", "ES", "IT"] as const) {
    assert.equal(registryAdapter(country).country, country);
    assert.equal(registryNumberLabel(country), "LEI");
    assert.equal(
      registryCompanyUrl(country, "529900DCE9HLEPY8MW24"),
      "https://search.gleif.org/#/record/529900DCE9HLEPY8MW24",
    );
  }
  assert.equal(spainRegistry.describeNumber?.("NIF B82827932"), "NIF B82827932");
});

test("Signalet siger, hvilket nummer der stod i materialet", () => {
  const [company] = records("gleif-it-10927360015.json")
    .map((row) => parseGleifRecord(row, "IT"))
    .filter((row) => row !== null);
  assert.ok(company);
  const signals = registryMatchSignals({
    company,
    registryName: italyRegistry.registryName,
    numberLabel: italyRegistry.numberLabel,
    context: context("Satispay"),
    websiteHost: null,
    fromMaterial: true,
    materialNumberText: "C.F. 10927360015",
  });
  assert.match(JSON.stringify(signals), /C\.F\. 10927360015 står i casens eget materiale/);
});
