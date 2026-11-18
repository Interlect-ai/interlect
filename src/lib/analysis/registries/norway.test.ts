/**
 * Norge-adapteren på rigtige svar fra Brønnøysundregistrene, gemt 7. okt 2026
 * (Spond AS og Tibber AS, offentlige data under NLOD 2.0). Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import {
  findNorwegianOrgNumbers,
  isValidNorwegianOrgNumber,
  normalizeNorwegianOrgNumber,
  parseBrregEntity,
  parseBrregStatements,
} from "./norway.ts";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}

test("org.nr. tjekkes med kontrolcifferet og normaliseres", () => {
  assert.equal(isValidNorwegianOrgNumber("998209218"), true);
  assert.equal(isValidNorwegianOrgNumber("923609016"), true);
  assert.equal(isValidNorwegianOrgNumber("998209217"), false);
  assert.equal(isValidNorwegianOrgNumber("12345678"), false);
  assert.equal(normalizeNorwegianOrgNumber("998 209 218"), "998209218");
  assert.equal(normalizeNorwegianOrgNumber("NO 998209218 MVA"), "998209218");
  assert.equal(normalizeNorwegianOrgNumber("998.209.218"), "998209218");
  assert.equal(normalizeNorwegianOrgNumber("DK 37561304"), null);
});

test("org.nr. findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  const footer =
    "Spond AS · Øvre Vollgate 11, 0158 Oslo · Org.nr. 998 209 218 · Ring +47 923 609 016";
  assert.deepEqual(findNorwegianOrgNumbers(footer), ["998209218"]);
  assert.deepEqual(
    findNorwegianOrgNumbers("Organisasjonsnummer: 923609016. MVA-nummer NO 998 209 218 MVA"),
    ["923609016", "998209218"],
  );
  assert.deepEqual(findNorwegianOrgNumbers("org no 998209218 og org.nr 998209218"), ["998209218"]);
  // Et telefonnummer eller et nummer uden "org"/"MVA" tæller ikke; et ugyldigt heller ikke.
  assert.deepEqual(findNorwegianOrgNumbers("Ring NO 923609016 eller 998209218"), []);
  assert.deepEqual(findNorwegianOrgNumbers("Org.nr. 998 209 217"), []);
});

test("en enhet fra Enhetsregisteret bliver et aktivt selskab med hjemmeside og gamle navne", () => {
  const company = parseBrregEntity(fixture("brreg-enhet-998209218.json"));
  assert.ok(company);
  assert.equal(company.country, "NO");
  assert.equal(company.registryNumber, "998209218");
  assert.equal(company.name, "SPOND AS");
  assert.equal(company.active, true);
  assert.equal(company.status, "aktiv");
  assert.deepEqual(company.formerNames, ["WR START UP 38 AS", "PULZE AS"]);
  assert.equal(company.registryUrl, "https://virksomhet.brreg.no/nb/oppslag/enheter/998209218");
  // Spond har ingen hjemmeside i registret; en oplyst hjemmeside får https foran.
  assert.equal(company.website, null);
  const withSite = parseBrregEntity({
    ...(fixture("brreg-enhet-998209218.json") as Record<string, unknown>),
    hjemmeside: "www.spond.com",
  });
  assert.equal(withSite?.website, "https://www.spond.com");
});

test("konkurs og sletning gør selskabet inaktivt; ugyldige svar giver null", () => {
  const base = fixture("brreg-enhet-998209218.json") as Record<string, unknown>;
  const bankrupt = parseBrregEntity({ ...base, konkurs: true, slettedato: "2026-01-02" });
  assert.equal(bankrupt?.active, false);
  assert.equal(bankrupt?.status, "konkurs, slettet");
  assert.equal(parseBrregEntity({ ...base, organisasjonsnummer: "998209217" }), null);
  assert.equal(parseBrregEntity(null), null);
  assert.equal(parseBrregEntity([]), null);
});

test("Spond: tre års selskabsregnskab i NOK, kun registrets egne tal", () => {
  const { statements, warnings } = parseBrregStatements(
    fixture("brreg-regnskap-998209218.json"),
    "998209218",
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    ["2025-12-31", "2024-12-31", "2023-12-31"],
  );
  const latest = statements[0]!;
  assert.equal(latest.currency, "NOK");
  assert.equal(latest.periodStart, "2025-01-01");
  assert.equal(latest.goingConcernNote, null);
  assert.equal(
    latest.sourceDocumentUrl,
    "https://data.brreg.no/regnskapsregisteret/regnskap/998209218/7035366",
  );
  assert.match(
    latest.reportingClassText ?? "",
    /Norsk årsregnskab \(regnskapsloven, små foretak\)/,
  );
  const value = (metric: string) => latest.lineItems.find((item) => item.metric === metric);
  assert.equal(value("revenue")?.value, 136331018);
  assert.equal(value("revenue")?.tag, "brreg:salgsinntekter");
  assert.equal(value("employee_expense")?.value, 50675021);
  assert.equal(value("operating_result")?.value, -33586022);
  assert.equal(value("cash")?.value, 31202704);
  assert.equal(value("equity")?.value, 37301607);
  // Indskudt egenkapital indeholder overkurs og er ikke selskabskapital; tilgodehavender er ikke
  // kun fra salg. Begge udelades hellere end at blive regnet forkert.
  assert.equal(value("contributed_capital"), undefined);
  assert.equal(value("trade_receivables"), undefined);
  // 2024: driftsindtægterne (117 mio.) er større end salget (102 mio.); kun salget er omsætning.
  const prior = statements[1]!.lineItems.find((item) => item.metric === "revenue");
  assert.equal(prior?.value, 102472510);
});

test("Tibber: koncernregnskabet bruges aldrig, kun selskabets eget", () => {
  const raw = fixture("brreg-regnskap-916276338.json") as Array<Record<string, unknown>>;
  const { statements } = parseBrregStatements(raw, "916276338");
  assert.equal(statements.length, 3);
  const selskapIds = raw
    .filter((row) => row["regnskapstype"] === "SELSKAP")
    .map((row) => String(row["id"]));
  for (const statement of statements) {
    assert.ok(selskapIds.some((id) => statement.sourceDocumentUrl.endsWith(`/${id}`)));
  }
});

test("et år i en anden valuta udelades med en advarsel; det senest indsendte år vinder", () => {
  const raw = fixture("brreg-regnskap-998209218.json") as Array<Record<string, unknown>>;
  const oldest = raw.find(
    (row) => (row["regnskapsperiode"] as Record<string, string>)["tilDato"] === "2023-12-31",
  )!;
  const resubmitted = { ...raw[raw.length - 1]!, id: 9_999_999 };
  const { statements, warnings } = parseBrregStatements(
    [...raw.filter((row) => row !== oldest), { ...oldest, valuta: "USD" }, resubmitted],
    "998209218",
  );
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    ["2025-12-31", "2024-12-31"],
  );
  assert.match(statements[0]!.sourceDocumentUrl, /\/9999999$/);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /2023-12-31 er i USD, ikke NOK/);
});

test("et år uden genkendte tal udelades med en advarsel; uden id peges på selskabets liste", () => {
  const raw = fixture("brreg-regnskap-998209218.json") as Array<Record<string, unknown>>;
  const newest = raw.find(
    (row) => (row["regnskapsperiode"] as Record<string, string>)["tilDato"] === "2025-12-31",
  )!;
  const rest = raw.filter((row) => row !== newest);
  const { statements, warnings } = parseBrregStatements(
    [
      ...rest.map((row) => ({ ...row, id: undefined })),
      { ...newest, resultatregnskapResultat: {}, eiendeler: {}, egenkapitalGjeld: {} },
    ],
    "998209218",
  );
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    ["2024-12-31", "2023-12-31"],
  );
  assert.equal(
    statements[0]!.sourceDocumentUrl,
    "https://data.brreg.no/regnskapsregisteret/regnskap/998209218",
  );
  assert.deepEqual(warnings, [
    "Regnskabet til 2025-12-31 har ingen af de tal, vi genkender, og er udeladt.",
  ]);
});

test("tomt eller fremmed svar giver ingen regnskaber", () => {
  assert.deepEqual(parseBrregStatements(null, "998209218").statements, []);
  assert.deepEqual(parseBrregStatements([], "998209218").statements, []);
  const raw = fixture("brreg-regnskap-998209218.json");
  assert.deepEqual(parseBrregStatements(raw, "916276338").statements, []);
});

test("nøgletalsmotoren regner på de norske tal som på de danske", () => {
  const { statements } = parseBrregStatements(
    fixture("brreg-regnskap-998209218.json"),
    "998209218",
  );
  const report = computeFinancialMetrics(
    statements.map((statement) => ({
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      sourceDocumentUrl: statement.sourceDocumentUrl,
      reportingClassText: statement.reportingClassText,
      lineItems: statement.lineItems.map(({ metric, value }) => ({ metric, value })),
    })),
    "2026-10-07",
  );
  assert.deepEqual(report.years, ["2023-12-31", "2024-12-31", "2025-12-31"]);
  const metric = (key: string) => report.metrics.find((item) => item.key === key)!;
  assert.equal(metric("revenue").latest?.value, 136331018);
  assert.equal(metric("revenue_growth").latest?.status, "ok");
  assert.ok(Math.abs(metric("revenue_growth").latest!.value! - 33.04) < 0.01);
  assert.equal(metric("equity_ratio").latest?.status, "ok");
  // Ingen af- og nedskrivninger i registret: burn regnes som et estimat, aldrig et gæt uden note.
  assert.equal(metric("operating_burn").latest?.status, "estimat");
  assert.equal(metric("runway_at_balance_date").latest?.status, "estimat");
});

test("beløb i NOK skrives med valutaen; danske beløb og procenter er uændrede", async () => {
  const { formatMetricValue } = await import("../financial-format.ts");
  const { statements } = parseBrregStatements(
    fixture("brreg-regnskap-998209218.json"),
    "998209218",
  );
  const input = statements.map((statement) => ({
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    sourceDocumentUrl: statement.sourceDocumentUrl,
    reportingClassText: statement.reportingClassText,
    lineItems: statement.lineItems.map(({ metric, value }) => ({ metric, value })),
  }));
  const norwegian = computeFinancialMetrics(input, "2026-10-07", { currency: "NOK" });
  const danish = computeFinancialMetrics(input, "2026-10-07");
  const pick = (report: typeof danish, key: string) =>
    report.metrics.find((item) => item.key === key)!;
  assert.equal(formatMetricValue(pick(norwegian, "revenue"), 136_331_018), "136 mio. NOK");
  assert.equal(formatMetricValue(pick(danish, "revenue"), 136_331_018), "136 mio.");
  assert.equal(pick(norwegian, "revenue_growth").currency, undefined);
  assert.equal(formatMetricValue(pick(norwegian, "revenue_growth"), 33), "33 %");
});
