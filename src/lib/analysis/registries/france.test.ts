/**
 * Frankrig-adapteren på rigtige svar, gemt 7. okt 2026: "Annuaire des entreprises"
 * (søgning på "doctolib", kun de felter, vi læser; personer fjernet) og INPI's nøgletal fra
 * `data.economie.gouv.fr` (Doctolib og Danone, Licence Ouverte 2.0). Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import { chooseRegistryMatch, registryNameAgrees } from "./match.ts";
import {
  findSirens,
  franceRegistry,
  isValidSiren,
  normalizeSiren,
  parseFrenchCompany,
  parseFrenchStatements,
  ratiosUrl,
} from "./france.ts";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}

test("SIREN: ni cifre med Luhn; SIRET og momsnummer giver SIREN", () => {
  assert.equal(isValidSiren("794598813"), true);
  assert.equal(isValidSiren("952418325"), true);
  assert.equal(isValidSiren("356000000"), true);
  assert.equal(isValidSiren("794598814"), false);
  assert.equal(isValidSiren("79459881"), false);
  assert.equal(normalizeSiren("794 598 813"), "794598813");
  assert.equal(normalizeSiren("794 598 813 00057"), "794598813");
  assert.equal(normalizeSiren("FR95952418325"), "952418325");
  assert.equal(normalizeSiren("123456789"), null);
});

test("SIREN findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  assert.deepEqual(findSirens("Doctolib SAS · RCS Nanterre 794 598 813 · Capital social 1 000 €"), [
    "794598813",
  ]);
  assert.deepEqual(findSirens("SIRET : 794 598 813 00057. N° TVA FR95952418325"), [
    "794598813",
    "952418325",
  ]);
  assert.deepEqual(findSirens("R.C.S. Paris B 952 418 325"), ["952418325"]);
  assert.deepEqual(findSirens("RCS Lyon 552.032.534 · SIREN 794-598-813"), [
    "552032534",
    "794598813",
  ]);
  // Et telefonnummer eller et tal uden mærke tæller ikke, og et ugyldigt nummer heller ikke.
  assert.deepEqual(findSirens("Tél. 794 598 813 · SIREN 794 598 814"), []);
});

test("søgning: selskaber læses; ophørte er ikke aktive; enkeltmandsvirksomheder aldrig", () => {
  const results = fixture("fr-search-doctolib.json")["results"] as Record<string, unknown>[];
  const companies = results.map(parseFrenchCompany).filter((c) => c !== null);
  assert.equal(companies[0]?.registryNumber, "794598813");
  assert.equal(companies[0]?.name, "DOCTOLIB");
  assert.equal(companies[0]?.active, true);
  assert.equal(
    companies[0]?.registryUrl,
    "https://annuaire-entreprises.data.gouv.fr/entreprise/794598813",
  );
  const doctolib = results[0]!;
  const closed = parseFrenchCompany({
    ...doctolib,
    etat_administratif: "C",
    date_fermeture: "2025-03-31",
  });
  assert.equal(closed?.active, false);
  assert.equal(closed?.status, "ophørt 2025-03-31");
  // Juridisk form 1000 er en enkeltmandsvirksomhed: en person, som aldrig slås op.
  assert.equal(
    parseFrenchCompany({
      ...doctolib,
      nom_complet: "LOUISE BENEY (DOCTOLIB)",
      nature_juridique: "1000",
    }),
    null,
  );
});

test("navnet i registret passer til mærket, også med selskabsform", () => {
  const agrees = registryNameAgrees({ brandName: "Doctolib" });
  assert.equal(agrees("DOCTOLIB"), true);
  assert.equal(agrees("DOCTOLIB SAS"), true);
  assert.equal(agrees("DOCTOLIB SASU"), true);
  assert.equal(agrees("SODEXO ENTREPRISES"), false);
});

test("regnskaber: det fulde regnskab, aldrig koncernen; alle år i EUR med kilde pr. år", () => {
  const { statements, warnings } = parseFrenchStatements(
    fixture("fr-ratios-794598813.json"),
    "794598813",
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    statements.map((s) => s.periodEnd),
    ["2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"],
  );
  const latest = statements[0]!;
  assert.equal(latest.currency, "EUR");
  assert.equal(latest.periodStart, "2024-01-01");
  assert.equal(latest.reportingClassText, "Fransk årsregnskab (INPI, åbne data)");
  // Selskabets eget regnskab (C), ikke koncernens 311.448.000.
  assert.deepEqual(latest.lineItems, [
    { metric: "revenue", value: 253437000, tag: "inpi:chiffre_d_affaires" },
    { metric: "operating_result", value: -79692000, tag: "inpi:ebit" },
    { metric: "net_result", value: -122327000, tag: "inpi:resultat_net" },
  ]);
  assert.equal(latest.sourceDocumentUrl, ratiosUrl("794598813", "2024-12-31"));
  assert.match(latest.sourceDocumentUrl, /date_cloture_exercice%3Ddate'2024-12-31'/);
});

test("regnskaber: to år med præcis samme tal udelades begge, med forklaring", () => {
  const { statements, warnings } = parseFrenchStatements(
    fixture("fr-ratios-552032534.json"),
    "552032534",
  );
  const ends = statements.map((s) => s.periodEnd);
  // 2025 og 2024 (forenklet) har samme tal; det samme 2022 og 2021 (fuldt). Ingen af dem bruges.
  assert.deepEqual(ends, ["2023-12-31", "2020-12-31", "2019-12-31", "2018-12-31", "2017-12-31"]);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0]!, /2024-12-31 og 2025-12-31 har præcis de samme tal/);
});

test("regnskaber: en fortrolig resultatopgørelse giver kun årets resultat, aldrig nuller", () => {
  const raw = {
    results: [
      {
        siren: "382410074",
        date_cloture_exercice: "2021-12-31",
        chiffre_d_affaires: 0,
        ebit: 0,
        resultat_net: 72175,
        type_bilan: "C",
        confidentiality: "Partiellement confidentiel",
      },
      {
        siren: "999999999",
        date_cloture_exercice: "2021-12-31",
        chiffre_d_affaires: 5,
        ebit: 5,
        resultat_net: 5,
        type_bilan: "C",
        confidentiality: "Public",
      },
    ],
  };
  const { statements, warnings } = parseFrenchStatements(raw, "382410074");
  assert.equal(statements.length, 1);
  assert.deepEqual(statements[0]!.lineItems, [
    { metric: "net_result", value: 72175, tag: "inpi:resultat_net" },
  ]);
  assert.match(warnings[0]!, /fortrolig/);
});

test("regnskaber: 0 betyder manglende tal; omsætning 0 kun ved et rigtigt resultat", () => {
  const row = (date: string, values: Record<string, number>, confidentiality = "Public") => ({
    siren: "794598813",
    date_cloture_exercice: date,
    type_bilan: "C",
    confidentiality,
    ...values,
  });
  const { statements } = parseFrenchStatements(
    {
      results: [
        row("2024-02-29", { chiffre_d_affaires: 0, ebit: -50000, resultat_net: -40000 }),
        row("2023-02-28", { chiffre_d_affaires: 0, ebit: 0, resultat_net: 0 }),
        row("2022-02-28", { chiffre_d_affaires: 900, ebit: 0, resultat_net: 0 }, "Confidentiel"),
        row("2021-02-28", { chiffre_d_affaires: 1200, ebit: 0, resultat_net: 300 }),
      ],
    },
    "794598813",
  );
  // 2023 (kun nuller) og 2022 (fortrolig med resultat 0) har intet rigtigt tal og udelades.
  assert.deepEqual(
    statements.map((s) => s.periodEnd),
    ["2024-02-29", "2021-02-28"],
  );
  assert.deepEqual(
    statements[0]!.lineItems.map((item) => [item.metric, item.value]),
    [
      ["revenue", 0],
      ["operating_result", -50000],
      ["net_result", -40000],
    ],
  );
  // Et år, der slutter 29. feb, begynder 1. marts året før.
  assert.equal(statements[0]!.periodStart, "2023-03-01");
  assert.deepEqual(
    statements[1]!.lineItems.map((item) => item.metric),
    ["revenue", "net_result"],
  );
});

test("nøgletalsmotoren regner på de franske tal", () => {
  const { statements } = parseFrenchStatements(fixture("fr-ratios-794598813.json"), "794598813");
  const report = computeFinancialMetrics(
    statements.map((statement) => ({
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      sourceDocumentUrl: statement.sourceDocumentUrl,
      reportingClassText: statement.reportingClassText,
      lineItems: statement.lineItems.map(({ metric, value }) => ({ metric, value })),
    })),
    "2026-10-07",
    { currency: "EUR", registryCountry: "FR" },
  );
  const metric = (key: string) => report.metrics.find((item) => item.key === key)!;
  assert.equal(metric("revenue").latest?.value, 253437000);
  assert.equal(metric("revenue_growth").latest?.status, "ok");
});

/** Erstatter fetch med faste svar i ét test; kalder `run` og gendanner. */
async function withFetch<T>(
  handler: (url: URL) => unknown,
  run: (calls: URL[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url);
    return new Response(JSON.stringify(handler(url)), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("adapteren: opslag på SIREN, navnesøgning og regnskaber (fixtures)", async () => {
  await withFetch(
    (url) =>
      url.hostname === "recherche-entreprises.api.gouv.fr"
        ? fixture("fr-search-doctolib.json")
        : fixture("fr-ratios-794598813.json"),
    async (calls) => {
      const found = await franceRegistry.lookupByNumber("794 598 813");
      assert.equal(found?.name, "DOCTOLIB");
      assert.equal(calls[0]?.searchParams.get("q"), "794598813");
      const hits = await franceRegistry.searchByName("Doctolib");
      assert.ok(hits.every((hit) => hit.registryNumber !== "990027724"));
      const chosen = chooseRegistryMatch({
        candidates: hits,
        context: { brandName: "Doctolib" },
        websiteHost: "doctolib.fr",
      });
      assert.equal(chosen.match?.registryNumber, "794598813");
      const { statements } = await franceRegistry.fetchStatements("794598813");
      assert.equal(statements.length, 4);
      const ratios = calls.at(-1)!;
      assert.equal(ratios.hostname, "data.economie.gouv.fr");
      assert.equal(ratios.searchParams.get("where"), 'siren="794598813"');
      assert.equal(await franceRegistry.lookupByNumber("123"), null);
    },
  );
});

test("adapteren: Frankrig er sat op og kan søge på navn", () => {
  assert.equal(franceRegistry.country, "FR");
  assert.equal(franceRegistry.configured(), true);
  assert.equal(franceRegistry.supportsNameSearch, true);
  assert.equal(franceRegistry.numberLabel, "SIREN");
});
