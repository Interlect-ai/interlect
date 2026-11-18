/**
 * Sverige. iXBRL-læseren køres på Bolagsverkets officielle eksempelfiler (K2 og K3, hentet fra
 * taxonomier.se 7. okt 2026). API-svarene er syntetiske i Bolagsverkets format,
 * indtil nøglen findes. Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import { parseIxNumber, parseSwedishIxbrl } from "./sweden-ixbrl.ts";
import {
  documentsFromResponse,
  findSwedishOrgNumbers,
  isValidSwedishOrgNumber,
  ixbrlFilesFromZip,
  mergeSwedishReports,
  organisationFromResponse,
  normalizeSwedishOrgNumber,
  parseBolagsverketOrganisation,
  parseDocumentList,
  readBestReport,
  swedenRegistry,
} from "./sweden.ts";
import type { RegistryStatement } from "./types.ts";

function fixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
}

test("org.nr.: Luhn, kun juridiske personer (aldrig et personnummer), alle skrivemåder", () => {
  assert.equal(isValidSwedishOrgNumber("5560125790"), true);
  assert.equal(isValidSwedishOrgNumber("5560125791"), false);
  // Et personnummer (enskild firma) har måneden på 3.-4. plads og slås aldrig op.
  assert.equal(isValidSwedishOrgNumber("8502021234"), false);
  assert.equal(normalizeSwedishOrgNumber("556012-5790"), "5560125790");
  assert.equal(normalizeSwedishOrgNumber("16 556012-5790"), "5560125790");
  assert.equal(normalizeSwedishOrgNumber("SE556012579001"), "5560125790");
  assert.equal(normalizeSwedishOrgNumber("998209218"), null);
});

test("org.nr. findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  assert.deepEqual(
    findSwedishOrgNumbers("Exempel AB · Org.nr 556012-5790 · Tel 08-556 036 07 93"),
    ["5560125790"],
  );
  assert.deepEqual(
    findSwedishOrgNumbers("Organisationsnummer: 556036-0793. Momsreg.nr SE556012579001"),
    ["5560360793", "5560125790"],
  );
  assert.deepEqual(findSwedishOrgNumbers("Ring 5560125790 eller org.nr 556012-5791"), []);
});

test("talformater: mellemrum som tusindtal, komma som decimal, streg som nul", () => {
  assert.equal(parseIxNumber("2 650 000", "ixt:numspacecomma"), 2650000);
  assert.equal(parseIxNumber("12,5", "ixt:numcomma"), 12.5);
  assert.equal(parseIxNumber("1,234.5", "ixt:numdotdecimal"), 1234.5);
  assert.equal(parseIxNumber("-", "ixt:fixed-zero"), 0);
  assert.equal(parseIxNumber("2\u00a0650", "ixt:numspacecomma"), 2650);
  assert.equal(parseIxNumber("n/a", "ixt:numspacecomma"), null);
});

test("K2-eksemplet: to års regnskab i SEK, kun registrets tal, balancen stemmer", () => {
  const report = parseSwedishIxbrl(fixture("se-k2-exempel-1.xhtml"), "https://example.test/k2");
  assert.equal(report.companyName, "Exempel 1 AB");
  assert.equal(report.orgNumber, "5569999999");
  assert.equal(report.framework, "K2");
  assert.deepEqual(
    report.statements.map((statement) => [statement.periodStart, statement.periodEnd]),
    [
      ["2016-01-01", "2016-12-31"],
      ["2015-01-01", "2015-12-31"],
    ],
  );
  const latest = report.statements[0]!;
  assert.equal(latest.currency, "SEK");
  assert.equal(latest.reportingClassText, "Svensk årsredovisning (K2, mindre företag)");
  const value = (metric: string) => latest.lineItems.find((item) => item.metric === metric)?.value;
  assert.equal(value("revenue"), 2_650_000);
  assert.equal(value("employee_expense"), 650_000);
  assert.equal(value("net_result"), 1_274_000);
  assert.equal(value("equity"), 2_390_000);
  assert.equal(value("contributed_capital"), 100_000);
  assert.equal(value("average_employees"), 2);
  assert.equal(value("assets"), value("liabilities_and_equity"));
  assert.equal(
    latest.lineItems.find((item) => item.metric === "revenue")?.tag,
    "se-gen-base:Nettoomsattning",
  );
});

test("K3-eksemplet: fortegn og skala; flerårsöversiktens år kommer med som ældre år", () => {
  const report = parseSwedishIxbrl(fixture("se-k3-exempel-1.xhtml"), "https://example.test/k3");
  assert.equal(report.framework, "K3");
  assert.deepEqual(
    report.statements.map((statement) => statement.periodEnd),
    ["2019-12-31", "2018-12-31", "2017-12-31", "2016-12-31"],
  );
  const value = (index: number, metric: string) =>
    report.statements[index]!.lineItems.find((item) => item.metric === metric)?.value;
  assert.equal(value(0, "cash_flow_operating"), -103_469);
  assert.equal(value(0, "revenue"), 93_954_830);
  // Flerårsöversikten står i tusinder (scale 3).
  assert.equal(value(2, "revenue"), 72_202_000);
  const metrics = computeFinancialMetrics(
    report.statements.map((statement) => ({
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      sourceDocumentUrl: statement.sourceDocumentUrl,
      reportingClassText: statement.reportingClassText,
      lineItems: statement.lineItems.map(({ metric, value: amount }) => ({
        metric,
        value: amount,
      })),
    })),
    "2020-06-30",
    { currency: "SEK", registryCountry: "SE" },
  );
  const metric = (key: string) => metrics.metrics.find((item) => item.key === key)!;
  assert.equal(metrics.currency, "SEK");
  assert.equal(metric("equity_ratio").latest?.status, "ok");
  assert.equal(metric("revenue_growth").latest?.status, "ok");
  assert.equal(metric("ebitda").latest?.value, 5_639_453 + 309_370);
});

test("Bolagsverkets selskab: navn, status, kun gyldigt org.nr.", () => {
  const response = {
    organisationer: [
      {
        organisationsidentitet: { identitetsbeteckning: "5560125790" },
        organisationsnamn: {
          organisationsnamnLista: [{ namn: "Exempel AB" }, { namn: "Gamla Exempel AB" }],
        },
        verksamOrganisation: { kod: "JA" },
      },
    ],
  };
  const company = parseBolagsverketOrganisation(response);
  assert.equal(company?.registryNumber, "5560125790");
  assert.equal(company?.name, "Exempel AB");
  assert.deepEqual(company?.formerNames, ["Gamla Exempel AB"]);
  assert.equal(company?.active, true);
  const deregistered = parseBolagsverketOrganisation({
    organisationer: [
      {
        ...response.organisationer[0],
        avregistreradOrganisation: { avregistreringsdatum: "2024-01-31" },
      },
    ],
  });
  assert.equal(deregistered?.active, false);
  assert.equal(deregistered?.status, "avregistrerad");
  assert.equal(parseBolagsverketOrganisation({ organisationer: [] }), null);
  assert.equal(
    parseBolagsverketOrganisation({
      organisationer: [
        {
          ...response.organisationer[0],
          organisationsidentitet: { identitetsbeteckning: "8502021234" },
        },
      ],
    }),
    null,
  );
});

test("dokumentlisten: nyeste periode først, senest registrerede ved samme periode", () => {
  const documents = parseDocumentList({
    dokument: [
      {
        dokumentId: "a",
        rapporteringsperiodTom: "2023-12-31",
        registreringstidpunkt: "2024-05-01",
      },
      {
        dokumentId: "b",
        rapporteringsperiodTom: "2024-12-31",
        registreringstidpunkt: "2025-05-01",
      },
      {
        dokumentId: "c",
        rapporteringsperiodTom: "2024-12-31",
        registreringstidpunkt: "2025-06-01",
      },
      { dokumentId: "", rapporteringsperiodTom: "2022-12-31" },
    ],
  });
  assert.deepEqual(
    documents.map((document) => document.id),
    ["c", "b", "a"],
  );
});

function statement(periodEnd: string, revenue: number, currency = "SEK"): RegistryStatement {
  return {
    periodStart: `${periodEnd.slice(0, 4)}-01-01`,
    periodEnd,
    currency,
    sourceDocumentUrl: `https://example.test/${periodEnd}`,
    reportingClassText: null,
    goingConcernNote: null,
    lineItems: [{ metric: "revenue", value: revenue, tag: "se-gen-base:Nettoomsattning" }],
  };
}

test("flere årsredovisningar: årets egen går forud for et senere års sammenligningstal", () => {
  const merged = mergeSwedishReports([
    {
      periodEnd: "2024-12-31",
      statements: [statement("2024-12-31", 300), statement("2023-12-31", 205)],
    },
    {
      periodEnd: "2023-12-31",
      statements: [statement("2023-12-31", 200), statement("2022-12-31", 100)],
    },
  ]);
  assert.deepEqual(
    merged.statements.map((item) => [item.periodEnd, item.lineItems[0]!.value]),
    [
      ["2024-12-31", 300],
      ["2023-12-31", 200],
      ["2022-12-31", 100],
    ],
  );
  const mixed = mergeSwedishReports([
    { periodEnd: "2024-12-31", statements: [statement("2024-12-31", 30, "EUR")] },
    { periodEnd: "2023-12-31", statements: [statement("2023-12-31", 200)] },
  ]);
  assert.deepEqual(
    mixed.statements.map((item) => item.periodEnd),
    ["2024-12-31"],
  );
  assert.match(mixed.warnings[0]!, /2023-12-31 er i SEK, ikke EUR/);
});

test("zip'en fra Bolagsverket: årsredovisningen vælges, ikke revisionsberetningen", () => {
  const xhtml = fixture("se-k2-exempel-1.xhtml");
  const audit = `<html xmlns="http://www.w3.org/1999/xhtml"><body>Revisionsberättelse</body></html>`;
  const zip = zipSync({
    "a-revisionsberattelse.xhtml": new TextEncoder().encode(audit),
    "bilaga.pdf": new Uint8Array([37, 80, 68, 70]),
    "b-arsredovisning.xhtml": new TextEncoder().encode(xhtml),
  });
  assert.equal(ixbrlFilesFromZip(zip).length, 2);
  const best = readBestReport(zip, "https://example.test/doc");
  assert.equal(best?.statements.length, 2);
  assert.equal(readBestReport(zipSync({ "bilaga.pdf": new Uint8Array([1]) }), "x"), null);
});

test("zip-grænser: højst 5 XHTML-filer, og en afskåret fil udelades", () => {
  const page = new TextEncoder().encode("<html><body>x</body></html>");
  const many = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [`f${String(index).padStart(2, "0")}.xhtml`, page]),
  );
  assert.equal(ixbrlFilesFromZip(zipSync(many)).length, 5);
  const cut = zipSync({ "arsredovisning.xhtml": new TextEncoder().encode("<html><body>1 2") });
  assert.deepEqual(ixbrlFilesFromZip(cut), []);
});

test("talformater: minus og parenteser i teksten, og intet gæt uden format", () => {
  assert.equal(parseIxNumber("-500", "ixt:numspacecomma"), -500);
  assert.equal(parseIxNumber("−1 250", "ixt:numspacecomma"), -1250);
  assert.equal(parseIxNumber("(500)", "ixt:numspacecomma"), -500);
  assert.equal(parseIxNumber("1,234", undefined), null);
  assert.equal(parseIxNumber("1234", undefined), 1234);
});

const MINI = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:i="http://www.xbrl.org/2013/inlineXBRL"
  xmlns:x="http://www.xbrl.org/2003/instance" xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
  xmlns:g="http://www.taxonomier.se/se/fr/gen-base/2021-10-31"
  xmlns:c="http://www.taxonomier.se/se/fr/cd-base/2021-10-31"><body>
<i:header><i:resources>
<x:context id="p0"><x:entity><x:identifier scheme="http://www.bolagsverket.se">556012-5790</x:identifier></x:entity><x:period><x:startDate>2024-01-01</x:startDate><x:endDate>2024-12-31</x:endDate></x:period></x:context>
<x:context id="b0"><x:entity><x:identifier scheme="http://www.bolagsverket.se">556012-5790</x:identifier></x:entity><x:period><x:instant>2024-12-31</x:instant></x:period></x:context>
<x:context id="other"><x:entity><x:identifier scheme="http://www.bolagsverket.se">556036-0793</x:identifier></x:entity><x:period><x:instant>2024-12-31</x:instant></x:period></x:context>
<x:unit id="SEK"><x:measure>iso4217:SEK</x:measure></x:unit>
</i:resources></i:header>
<c:x/><i:nonNumeric name="c:Organisationsnummer" contextRef="p0">556012-5790</i:nonNumeric>
${body}
</body></html>`;

test("egne præfikser, et underskud med minus i teksten og kun selskabets egne kontekster", () => {
  const report = parseSwedishIxbrl(
    MINI(`
<i:nonFraction name="g:Nettoomsattning" contextRef="p0" unitRef="SEK" decimals="INF" format="ixt:numspacecomma">1 000</i:nonFraction>
<i:nonFraction name="g:AretsResultat" contextRef="p0" unitRef="SEK" decimals="INF" format="ixt:numspacecomma">-250</i:nonFraction>
<i:nonFraction name="g:Tillgangar" contextRef="b0" unitRef="SEK" decimals="INF" format="ixt:numspacecomma">5 000</i:nonFraction>
<i:nonFraction name="g:EgetKapital" contextRef="other" unitRef="SEK" decimals="INF" format="ixt:numspacecomma">9 999</i:nonFraction>
<i:nonFraction name="g:LikvidaMedel" contextRef="b0" unitRef="USD" decimals="INF" format="ixt:numspacecomma">77</i:nonFraction>`),
    "https://example.test/mini",
  );
  assert.equal(report.orgNumber, "5560125790");
  assert.equal(report.statements.length, 1);
  const items = Object.fromEntries(
    report.statements[0]!.lineItems.map((item) => [item.metric, item.value]),
  );
  assert.deepEqual(items, { revenue: 1000, net_result: -250, assets: 5000 });
});

test("Bolagsverkets svar i et andet format er en fejl, ikke 'ikke fundet'", () => {
  assert.equal(organisationFromResponse({ organisationer: [] }), null);
  assert.throws(() => organisationFromResponse({ data: [] }), /kunne ikke læses/);
  assert.throws(() => documentsFromResponse({ dokumenter: [] }), /kunne ikke læses/);
  assert.deepEqual(documentsFromResponse({ dokument: [] }), []);
});

test("uden nøgle er Bolagsverket ikke sat op, og der søges aldrig på navn", async () => {
  const saved = [process.env["BOLAGSVERKET_CLIENT_ID"], process.env["BOLAGSVERKET_CLIENT_SECRET"]];
  delete process.env["BOLAGSVERKET_CLIENT_ID"];
  delete process.env["BOLAGSVERKET_CLIENT_SECRET"];
  try {
    assert.equal(swedenRegistry.configured(), false);
    assert.equal(swedenRegistry.supportsNameSearch, false);
    assert.deepEqual(await swedenRegistry.searchByName("Exempel"), []);
  } finally {
    if (saved[0]) process.env["BOLAGSVERKET_CLIENT_ID"] = saved[0];
    if (saved[1]) process.env["BOLAGSVERKET_CLIENT_SECRET"] = saved[1];
  }
});

test("Bolagsverket-klienten: ny nøgle ved 401, og ulæselige årsredovisningar er en fejl", async () => {
  const saved = {
    fetch: globalThis.fetch,
    id: process.env["BOLAGSVERKET_CLIENT_ID"],
    secret: process.env["BOLAGSVERKET_CLIENT_SECRET"],
  };
  process.env["BOLAGSVERKET_CLIENT_ID"] = "test-id";
  process.env["BOLAGSVERKET_CLIENT_SECRET"] = "test-secret";
  const calls: string[] = [];
  let tokens = 0;
  let rejectedOnce = false;
  const auditOnly = zipSync({
    "revisionsberattelse.xhtml": new TextEncoder().encode("<html><body>Revision</body></html>"),
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url.replace(/^https:\/\/[^/]+/, ""));
    if (url.includes("oauth2/token")) {
      tokens += 1;
      return Response.json({ access_token: `t${tokens}`, expires_in: 3600 });
    }
    if (url.endsWith("/dokumentlista")) {
      if (!rejectedOnce) {
        rejectedOnce = true;
        return new Response("", { status: 401 });
      }
      return Response.json({
        dokument: [{ dokumentId: "d1", rapporteringsperiodTom: "2024-12-31" }],
      });
    }
    if (url.includes("/dokument/d1")) return new Response(auditOnly);
    return new Response("", { status: 500 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      swedenRegistry.fetchStatements("556012-5790"),
      /har 1 årsredovisningar, men ingen kunne læses/,
    );
    // Den afviste nøgle blev smidt ud, og en ny blev hentet før det andet forsøg.
    assert.equal(tokens, 2);
    assert.deepEqual(calls.filter((call) => call.endsWith("/dokumentlista")).length, 2);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.id) process.env["BOLAGSVERKET_CLIENT_ID"] = saved.id;
    else delete process.env["BOLAGSVERKET_CLIENT_ID"];
    if (saved.secret) process.env["BOLAGSVERKET_CLIENT_SECRET"] = saved.secret;
    else delete process.env["BOLAGSVERKET_CLIENT_SECRET"];
  }
});
