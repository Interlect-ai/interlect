/**
 * Finland-adapteren på rigtige svar fra PRH, gemt 7. okt 2026 (Supercell Oy i YTJ,
 * Asuntotekniikka Oy og et andet aktieselskab i XBRL-API'et, offentlige data under CC BY 4.0).
 * Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import { parseFinnishXbrl } from "./finland-xbrl.ts";
import {
  financialDatesFrom,
  findFinnishBusinessIds,
  finlandRegistry,
  isValidFinnishBusinessId,
  normalizeFinnishBusinessId,
  parseYtjCompany,
} from "./finland.ts";

function fixtureText(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
}
function fixture(name: string): unknown {
  return JSON.parse(fixtureText(name));
}

test("Y-tunnus tjekkes med kontrolcifferet og normaliseres", () => {
  assert.equal(isValidFinnishBusinessId("2336509-6"), true);
  assert.equal(isValidFinnishBusinessId("0100379-9"), true);
  assert.equal(isValidFinnishBusinessId("2336509-7"), false);
  assert.equal(isValidFinnishBusinessId("23365096"), false);
  assert.equal(normalizeFinnishBusinessId("2336509-6"), "2336509-6");
  assert.equal(normalizeFinnishBusinessId("23365096"), "2336509-6");
  assert.equal(normalizeFinnishBusinessId("FI23365096"), "2336509-6");
  // Ældre numre uden foranstillet nul.
  assert.equal(normalizeFinnishBusinessId("100379-9"), "0100379-9");
  assert.equal(normalizeFinnishBusinessId("998209218"), null);
  assert.equal(normalizeFinnishBusinessId("2336509-5"), null);
});

test("Y-tunnus findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  assert.deepEqual(
    findFinnishBusinessIds("Supercell Oy · Y-tunnus 2336509-6 · Tel +358 40 123 4567"),
    ["2336509-6"],
  );
  assert.deepEqual(
    findFinnishBusinessIds(
      "Business ID: 0100379-9. VAT FI23365096, Y-tunnus/Business ID 0100379-9",
    ),
    ["0100379-9", "2336509-6"],
  );
  assert.deepEqual(findFinnishBusinessIds("Ring 2336509-6 eller Y-tunnus 2336509-7"), []);
});

test("YTJ: aktivt selskab med parallelt navn og hjemmeside", () => {
  const body = fixture("ytj-supercell-2336509-6.json") as { companies: unknown[] };
  const company = parseYtjCompany(body.companies[0]);
  assert.ok(company);
  assert.equal(company.country, "FI");
  assert.equal(company.registryNumber, "2336509-6");
  assert.equal(company.name, "Supercell Oy");
  assert.deepEqual(company.formerNames, ["Supercell Ltd"]);
  assert.equal(company.active, true);
  assert.equal(company.website, "https://www.supercell.com");
});

test("YTJ: opløst selskab og selskab under likvidation er ikke aktive", () => {
  const body = fixture("ytj-supercell-2336509-6.json") as { companies: Record<string, unknown>[] };
  const base = body.companies[0]!;
  const dissolved = parseYtjCompany({ ...base, endDate: "2024-03-01" });
  assert.equal(dissolved?.active, false);
  assert.match(dissolved!.status, /opløst/);
  const liquidation = parseYtjCompany({
    ...base,
    companySituations: [{ type: "SELTILA", registrationDate: "2025-01-01", source: "1" }],
  });
  assert.equal(liquidation?.active, false);
  assert.match(liquidation!.status, /likvidation/);
  // En afsluttet situation tæller ikke.
  const over = parseYtjCompany({
    ...base,
    companySituations: [{ type: "SANE", endDate: "2020-01-01", source: "1" }],
  });
  assert.equal(over?.active, true);
  assert.equal(parseYtjCompany({ businessId: { value: "2336509-5" }, names: [] }), null);
  assert.equal(parseYtjCompany(null), null);
});

test("listen over digitale regnskaber: nyeste først, op til otte, kun selskabets eget nummer", () => {
  const list = fixture("fi-financials-0100379-9.json");
  assert.deepEqual(financialDatesFrom(list, "0100379-9"), [
    "2025-12-31",
    "2024-12-31",
    "2023-12-31",
    "2022-12-31",
    "2021-12-31",
    "2020-12-31",
  ]);
  assert.deepEqual(financialDatesFrom(list, "2336509-6"), []);
  assert.deepEqual(financialDatesFrom({ totalResults: 0, financials: [] }, "0100379-9"), []);
});

test("XBRL: aktieselskab med resultat og balance læses direkte fra registrets koder", () => {
  const { statement, businessId } = parseFinnishXbrl(
    fixtureText("fi-xbrl-0133265-6-2024.xml"),
    "2024-12-31",
    "https://example.test/xbrl",
  );
  assert.equal(businessId, "0133265-6");
  assert.ok(statement);
  assert.equal(statement.periodStart, "2024-01-01");
  assert.equal(statement.periodEnd, "2024-12-31");
  assert.equal(statement.currency, "EUR");
  const value = (metric: string) =>
    statement.lineItems.find((item) => item.metric === metric)?.value;
  assert.equal(value("revenue"), 473569.75);
  assert.equal(value("operating_result"), 54630.1);
  assert.equal(value("net_result"), 37142.56);
  assert.equal(value("assets"), 802745.23);
  assert.equal(value("equity"), 450624.23);
  assert.equal(value("contributed_capital"), 8409.4);
  assert.equal(value("trade_receivables"), 100302.53);
  // Omkostninger står negative i XBRL og bliver positive; en skat er en omkostning.
  assert.equal(value("employee_expense"), 135477.69);
  assert.equal(value("tax_expense"), 10460.38);
  // Balancen går op, og posten kommer fra registrets egen kode.
  assert.equal(value("assets"), value("liabilities_and_equity"));
  assert.equal(statement.lineItems.find((item) => item.metric === "assets")?.tag, "fi_MC:x360");
  // Året før (dimensionen REF) er ikke med.
  assert.equal(statement.lineItems.filter((item) => item.metric === "revenue").length, 1);
});

test("XBRL: lille selskab uden omsætning giver kun de poster, registret oplyser", () => {
  const { statement } = parseFinnishXbrl(
    fixtureText("fi-xbrl-0100379-9-2024.xml"),
    "2024-12-31",
    "https://example.test/xbrl",
  );
  assert.ok(statement);
  const metrics = statement.lineItems.map((item) => item.metric);
  assert.ok(!metrics.includes("revenue"));
  assert.ok(metrics.includes("assets"));
  assert.equal(statement.lineItems.find((item) => item.metric === "net_result")?.value, 9617.04);
  // Skat som omkostning: Tuloverot −2.152,40 bliver 2.152,40; -0 bliver ikke vist som −0.
  assert.equal(statement.lineItems.find((item) => item.metric === "tax_expense")?.value, 2152.4);
  assert.ok(statement.lineItems.every((item) => !Object.is(item.value, -0)));
});

test("XBRL: forkert slutdato, tom eller fremmed instans giver intet regnskab", () => {
  const xml = fixtureText("fi-xbrl-0133265-6-2024.xml");
  assert.equal(parseFinnishXbrl(xml, "2023-12-31", "u").statement, null);
  assert.equal(parseFinnishXbrl("<xbrl/>", "2024-12-31", "u").statement, null);
  assert.equal(parseFinnishXbrl("ikke xml", "2024-12-31", "u").statement, null);
});

test("nøgletalsmotoren regner på de finske tal som på de danske", () => {
  const { statement } = parseFinnishXbrl(
    fixtureText("fi-xbrl-0133265-6-2024.xml"),
    "2024-12-31",
    "https://example.test/xbrl",
  );
  const report = computeFinancialMetrics(
    [
      {
        periodStart: statement!.periodStart,
        periodEnd: statement!.periodEnd,
        sourceDocumentUrl: statement!.sourceDocumentUrl,
        reportingClassText: statement!.reportingClassText,
        lineItems: statement!.lineItems.map(({ metric, value }) => ({ metric, value })),
      },
    ],
    "2026-10-07",
    { currency: "EUR", registryCountry: "FI" },
  );
  const metric = (key: string) => report.metrics.find((item) => item.key === key)!;
  assert.equal(metric("revenue").latest?.value, 473569.75);
  assert.equal(metric("equity_ratio").latest?.status, "ok");
  assert.ok(Math.abs(metric("equity_ratio").latest!.value! - 56.13) < 0.01);
});

/** Erstatter fetch med faste svar i ét test; kalder `run` og gendanner. */
async function withFetch<T>(
  handler: (url: string) => { status?: number; body: string },
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const { status = 200, body } = handler(url);
    return new Response(body, { status });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("adapteren: lookup, søgning og regnskaber mod PRH's API (fixtures)", async () => {
  const ytj = fixtureText("ytj-supercell-2336509-6.json");
  const xbrl = fixtureText("fi-xbrl-0133265-6-2024.xml");
  await withFetch(
    (url) => {
      if (url.includes("opendata-ytj-api")) return { body: ytj };
      if (url.includes("/financials?")) {
        return {
          body: JSON.stringify({
            totalResults: 2,
            financials: [
              { businessId: "0133265-6", financialDate: "2023-12-31" },
              { businessId: "0133265-6", financialDate: "2024-12-31" },
            ],
          }),
        };
      }
      return { body: xbrl };
    },
    async (calls) => {
      const found = await finlandRegistry.lookupByNumber("2336509-6");
      assert.equal(found?.name, "Supercell Oy");
      assert.match(calls[0]!, /businessId=2336509-6/);
      const searched = await finlandRegistry.searchByName("Supercell");
      assert.equal(searched.length, 1);
      assert.match(calls[1]!, /name=Supercell/);
      assert.equal(await finlandRegistry.lookupByNumber("not-a-number"), null);

      const result = await finlandRegistry.fetchStatements("0133265-6");
      // 2023-instansen er den samme fil, men dens slutdato passer ikke: den udelades med en advarsel.
      assert.deepEqual(
        result.statements.map((statement) => statement.periodEnd),
        ["2024-12-31"],
      );
      assert.equal(result.warnings.length, 1);
      assert.match(result.warnings[0]!, /2023-12-31/);
      assert.match(
        result.statements[0]!.sourceDocumentUrl,
        /financial\?businessId=0133265-6&financialDate=2024-12-31/,
      );
    },
  );
});

test("adapteren: intet digitalt regnskab giver en tom liste med forklaring; 429 er en fejl", async () => {
  await withFetch(
    () => ({ body: JSON.stringify({ totalResults: 0, financials: [] }) }),
    async () => {
      const result = await finlandRegistry.fetchStatements("0112038-9");
      assert.deepEqual(result.statements, []);
      assert.match(result.warnings[0]!, /digitalt/);
    },
  );
  await withFetch(
    () => ({ status: 429, body: "Too many requests" }),
    async () => {
      await assert.rejects(finlandRegistry.fetchStatements("0112038-9"), /for mange kald/);
    },
  );
});
