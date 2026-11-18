/**
 * Holland-adapteren på rigtige svar, gemt 7. okt 2026: KVK's åbne regnskab for Mollie
 * B.V. (KVK 30204462, regnskabsår 2020, CC BY 4.0) og GLEIF's LEI-poster (CC0). Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import { chooseRegistryMatch, registryNameAgrees } from "./match.ts";
import {
  findKvkNumbers,
  isValidKvkNumber,
  netherlandsRegistry,
  normalizeKvkNumber,
  parseGleifCompany,
  parseKvkStatement,
} from "./netherlands.ts";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}
const records = (name: string) => fixture(name)["data"] as Record<string, unknown>[];

test("KVK-nummer: otte cifre", () => {
  assert.equal(isValidKvkNumber("30204462"), true);
  assert.equal(isValidKvkNumber("3020446"), false);
  assert.equal(isValidKvkNumber("00000000"), false);
  assert.equal(normalizeKvkNumber("KvK 3020 4462"), "30204462");
  assert.equal(normalizeKvkNumber("KvK-nummer: 30204462"), "30204462");
  assert.equal(normalizeKvkNumber("000037178598"), null);
});

test("KVK findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  assert.deepEqual(
    findKvkNumbers("Mollie B.V. · Keizersgracht 126 · KvK-nummer: 30204462 · BTW NL815839091B01"),
    ["30204462"],
  );
  assert.deepEqual(
    findKvkNumbers("Chamber of Commerce 3020 4462 · KVK nr. 63892405 · CoC no. 30204462"),
    ["30204462", "63892405"],
  );
  assert.deepEqual(findKvkNumbers("Bel 0201234567 of 30204462"), []);
  assert.deepEqual(findKvkNumbers("Kamer van Koophandel 30204462"), ["30204462"]);
  // Et vestigingsnummer (12 cifre) med mellemrum giver aldrig et KVK-nummer.
  assert.deepEqual(findKvkNumbers("KvK 0000 3717 8598"), []);
});

test("GLEIF: navnet på KVK-nummeret; kun selskaber registreret i KVK; ophørte er ikke aktive", () => {
  const raw = records("gleif-nl-30204462.json")[0]!;
  const company = parseGleifCompany(raw);
  assert.ok(company);
  assert.equal(company.registryNumber, "30204462");
  assert.equal(company.name, "Mollie B.V.");
  assert.equal(company.active, true);
  assert.equal(
    company.registryUrl,
    "https://opendata.kvk.nl/api/v1/hvds/jaarrekeningen/kvknummer/30204462",
  );
  const attributes = raw["attributes"] as { entity: Record<string, unknown> };
  const withEntity = (entity: Record<string, unknown>) =>
    parseGleifCompany({
      ...raw,
      attributes: { ...attributes, entity: { ...attributes.entity, ...entity } },
    });
  assert.equal(withEntity({ registeredAt: { id: "RA000999", other: null } }), null);
  const closed = withEntity({
    status: "INACTIVE",
    expiration: { date: "2024-01-01", reason: "DISSOLVED" },
  });
  assert.equal(closed?.active, false);
  assert.equal(closed?.status, "ophørt (dissolved)");
  assert.deepEqual(
    withEntity({
      otherNames: [
        { name: "Mollie Payments B.V.", type: "PREVIOUS_LEGAL_NAME" },
        { name: "Mollie", type: "TRADING_OR_OPERATING_NAME" },
      ],
    })?.formerNames,
    ["Mollie Payments B.V."],
  );
});

test("navnesøgning via GLEIF: et holdingselskab med samme navn gør valget flertydigt", () => {
  const candidates = records("gleif-nl-search-mollie.json")
    .map(parseGleifCompany)
    .filter((c) => c !== null);
  assert.ok(candidates.length >= 3);
  assert.equal(registryNameAgrees({ brandName: "Mollie" })("Mollie B.V."), true);
  const chosen = chooseRegistryMatch({
    candidates,
    context: { brandName: "Mollie" },
    websiteHost: "mollie.com",
  });
  // Den fælles navneregel ser bort fra "Holding", så "Mollie Holding B.V." er lige så god som
  // "Mollie B.V."; intet vælges, og et nummer i decket eller et menneske må afgøre det.
  assert.equal(chosen.match, null);
  assert.deepEqual(chosen.ambiguous.map((company) => company.registryNumber).sort(), [
    "30204462",
    "63892405",
  ]);
  const withoutHolding = chooseRegistryMatch({
    candidates: candidates.filter((company) => company.registryNumber !== "63892405"),
    context: { brandName: "Mollie" },
    websiteHost: "mollie.com",
  });
  assert.equal(withoutHolding.match?.registryNumber, "30204462");
});

test("KVK's regnskab: kun selskabets eget, poster i EUR med KVK's feltnavn", () => {
  const { statements, warnings } = parseKvkStatement(
    fixture("kvk-jaarrekening-30204462.json"),
    "30204462",
  );
  assert.equal(statements.length, 1);
  const statement = statements[0]!;
  assert.equal(statement.periodEnd, "2020-12-31");
  assert.equal(statement.currency, "EUR");
  const value = (metric: string) =>
    statement.lineItems.find((item) => item.metric === metric)?.value;
  assert.equal(value("assets"), 194495000);
  assert.equal(value("liabilities_and_equity"), 194495000);
  assert.equal(value("equity"), 7663000);
  assert.equal(value("cash"), 159186000);
  assert.equal(value("operating_result"), -4983000);
  assert.equal(value("net_result"), -5166000);
  assert.equal(value("gross_profit"), 34454000);
  // "Receivables" er alle tilgodehavender, ikke kun fra salg, og bruges ikke.
  assert.equal(value("trade_receivables"), undefined);
  assert.equal(statement.lineItems.find((item) => item.metric === "equity")?.tag, "kvk:Equity");
  assert.deepEqual(warnings, []);

  // Koncernens tal bruges aldrig.
  const consolidated = parseKvkStatement(
    {
      opendataFields: [
        { key: "FinancialYear", value: "2024" },
        { key: "ConsolidatedBalanceSheet", opendataFields: [{ key: "Assets", value: "999" }] },
      ],
    },
    "30204462",
  );
  assert.equal(consolidated.statements.length, 0);
});

test("KVK's regnskab: skævt regnskabsår, ulæseligt år og en balance, der ikke går op, udelades", () => {
  const statement = (fields: Array<Record<string, unknown>>) =>
    parseKvkStatement({ opendataFields: fields }, "30204462");
  const balance = (assets: string, total: string) => ({
    key: "BalanceSheet",
    opendataFields: [
      { key: "Assets", value: assets },
      { key: "EquityAndLiabilities", value: total },
    ],
  });
  const offYear = statement([
    { key: "FinancialYear", value: "2024" },
    { key: "DocumentAdoptionDate", value: "2024-11-30" },
    balance("10", "10"),
  ]);
  assert.equal(offYear.statements.length, 0);
  assert.match(offYear.warnings[0]!, /følger ikke kalenderåret/);
  const oddYear = statement([{ key: "FinancialYear", value: "2020/2021" }, balance("10", "10")]);
  assert.match(oddYear.warnings[0]!, /kan ikke læses/);
  const unbalanced = statement([{ key: "FinancialYear", value: "2024" }, balance("10", "11")]);
  assert.equal(unbalanced.statements.length, 0);
  assert.match(unbalanced.warnings[0]!, /går ikke op/);
  assert.equal(
    statement([
      { key: "FinancialYear", value: "2024" },
      { key: "DocumentAdoptionDate", value: "2025-06-01" },
      balance("10", "10"),
    ]).statements.length,
    1,
  );
});

test("nøgletalsmotoren regner på de hollandske tal", () => {
  const { statements } = parseKvkStatement(fixture("kvk-jaarrekening-30204462.json"), "30204462");
  const report = computeFinancialMetrics(
    statements.map((statement) => ({
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      sourceDocumentUrl: statement.sourceDocumentUrl,
      reportingClassText: statement.reportingClassText,
      lineItems: statement.lineItems.map(({ metric, value }) => ({ metric, value })),
    })),
    "2026-10-07",
    { currency: "EUR", registryCountry: "NL" },
  );
  const metric = (key: string) => report.metrics.find((item) => item.key === key)!;
  assert.equal(metric("equity_ratio").latest?.status, "ok");
});

test("adapteren: opslag via GLEIF og regnskab fra KVK (fixtures); intet regnskab giver forklaring", async () => {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  let kvkStatus = 200;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push(url);
    if (url.hostname === "api.gleif.org") {
      return new Response(JSON.stringify(fixture("gleif-nl-30204462.json")), { status: 200 });
    }
    return kvkStatus === 200
      ? new Response(JSON.stringify(fixture("kvk-jaarrekening-30204462.json")), { status: 200 })
      : new Response("{}", { status: kvkStatus });
  }) as typeof fetch;
  try {
    const found = await netherlandsRegistry.lookupByNumber("KvK 30204462");
    assert.equal(found?.name, "Mollie B.V.");
    assert.equal(calls[0]?.searchParams.get("filter[entity.registeredAs]"), "30204462");
    assert.equal(calls[0]?.searchParams.get("filter[entity.jurisdiction]"), "NL");
    assert.equal((await netherlandsRegistry.fetchStatements("30204462")).statements.length, 1);
    kvkStatus = 404;
    const none = await netherlandsRegistry.fetchStatements("30204462");
    assert.deepEqual(none.statements, []);
    assert.match(none.warnings[0]!, /intet regnskab indsendt som XBRL/);
    kvkStatus = 429;
    await assert.rejects(netherlandsRegistry.fetchStatements("30204462"), /ét opslag i minuttet/);
  } finally {
    globalThis.fetch = original;
  }
});
