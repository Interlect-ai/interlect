/**
 * Letland-adapteren på rigtige svar fra data.gov.lv, gemt 7. okt 2026 (AS "Printful
 * Latvia": Uzņēmumu reģistrs og VID's årsregnskaber, CC0). Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import {
  findLatvianRegNumbers,
  isValidLatvianRegNumber,
  latviaRegistry,
  nameQuery,
  normalizeLatvianRegNumber,
  parseLatvianCompany,
  parseLatvianStatements,
  parseStatementRows,
} from "./latvia.ts";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}
const records = (name: string) => fixture(name)["records"] as Record<string, unknown>[];

test("reg.nr.: 11 cifre for juridiske personer, aldrig en personkode", () => {
  assert.equal(isValidLatvianRegNumber("40203050078"), true);
  assert.equal(isValidLatvianRegNumber("50003012341"), true);
  // Personkoder (DDMMÅÅ-xxxxx og de nye 32-koder) starter på 0–3 og slås aldrig op.
  assert.equal(isValidLatvianRegNumber("01019012345"), false);
  assert.equal(isValidLatvianRegNumber("32345678901"), false);
  assert.equal(isValidLatvianRegNumber("4020305007"), false);
  assert.equal(normalizeLatvianRegNumber("LV 40203050078"), "40203050078");
  assert.equal(normalizeLatvianRegNumber("4020 3050 078"), "40203050078");
  assert.equal(normalizeLatvianRegNumber("998209218"), null);
});

test("reg.nr. findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  assert.deepEqual(
    findLatvianRegNumbers('AS "Printful Latvia" · Reģ. Nr. 40203050078 · Tel. 2012 3456 789'),
    ["40203050078"],
  );
  assert.deepEqual(findLatvianRegNumbers("Registration number: 40203328614. VAT LV40203050078"), [
    "40203328614",
    "40203050078",
  ]);
  assert.deepEqual(findLatvianRegNumbers("Ring 40203050078 eller reg. no. 01019012345"), []);
});

test("registret: aktivt selskab; likvideret og udgået ved reorganisering er ikke aktive", () => {
  const record = records("lv-register-40203050078.json")[0]!;
  const company = parseLatvianCompany(record);
  assert.ok(company);
  assert.equal(company.registryNumber, "40203050078");
  assert.equal(company.name, 'AS "Printful Latvia"');
  assert.equal(company.active, true);
  assert.equal(
    parseLatvianCompany({ ...record, closed: "L", terminated: "2023-10-17T00:00:00" })?.active,
    false,
  );
  assert.match(parseLatvianCompany({ ...record, closed: "L" })!.status, /likvideret/);
  assert.match(parseLatvianCompany({ ...record, closed: "R" })!.status, /reorganisering/);
  assert.equal(parseLatvianCompany({ ...record, regcode: 1019012345 }), null);
});

test("tekstsøgningen bygges kun af bogstaver og cifre", () => {
  assert.equal(nameQuery("Printful Bits"), "Printful & Bits:*");
  assert.equal(nameQuery('A "B" & c; drop table'), "A & B & c & drop & table:*");
  assert.equal(
    nameQuery("Sabiedrība ar ierobežotu atbildību"),
    "Sabiedrība & ar & ierobežotu & atbildību:*",
  );
  assert.equal(nameQuery("''; --"), null);
});

test("årsregnskaber: ét pr. år, koncernregnskabet (UKGP) udelades, nyeste først", () => {
  const rows = parseStatementRows(fixture("lv-statements-40203050078.json"));
  assert.deepEqual(
    rows.slice(0, 3).map((row) => [row.id, row.periodEnd]),
    [
      [2350165, "2025-12-31"],
      [2084312, "2024-12-31"],
      [1939124, "2023-12-31"],
    ],
  );
  assert.ok(rows.every((row) => row.scale === 1 && row.currency === "EUR"));
  // En senere indsendelse for samme år vinder.
  const resubmitted = {
    ...records("lv-statements-40203050078.json")[1]!,
    id: 9_999_999,
    source_type: "UGP",
    year: 2025,
    year_ended_on: "2025-12-31T00:00:00",
  };
  const again = parseStatementRows({
    records: [...records("lv-statements-40203050078.json"), resubmitted],
  });
  assert.equal(again[0]!.id, 9_999_999);
});

test("balance og resultat fra registrets egne felter; beløb står i registrets valuta", () => {
  const rows = parseStatementRows(fixture("lv-statements-40203050078.json")).slice(0, 3);
  const { statements, warnings } = parseLatvianStatements(
    rows,
    fixture("lv-balance-40203050078.json"),
    fixture("lv-income-40203050078.json"),
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    ["2025-12-31", "2024-12-31", "2023-12-31"],
  );
  const latest = statements[0]!;
  const value = (metric: string) => latest.lineItems.find((item) => item.metric === metric)?.value;
  assert.equal(latest.currency, "EUR");
  assert.equal(value("revenue"), 85252452);
  assert.equal(value("net_result"), 1417675);
  assert.equal(value("assets"), 65432487);
  assert.equal(value("assets"), value("liabilities_and_equity"));
  assert.equal(value("equity"), 50287103);
  assert.equal(value("average_employees"), 560);
  // Debitorer er ikke kun fra salg, så de bliver ikke til tilgodehavender fra salg.
  assert.equal(value("trade_receivables"), undefined);
  assert.match(latest.sourceDocumentUrl, /statement_id%22%3A2350165/);
});

test("tal afrundet til tusinder ganges op; et år i en anden valuta udelades", () => {
  const rows = parseStatementRows(fixture("lv-statements-40203050078.json")).slice(0, 3);
  const thousands = rows.map((row, index) => ({
    ...row,
    scale: index === 0 ? 1000 : 1,
    currency: index === 2 ? "LVL" : "EUR",
  }));
  const { statements, warnings } = parseLatvianStatements(
    thousands,
    fixture("lv-balance-40203050078.json"),
    fixture("lv-income-40203050078.json"),
  );
  assert.equal(
    statements[0]!.lineItems.find((item) => item.metric === "assets")?.value,
    65432487000,
  );
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    ["2025-12-31", "2024-12-31"],
  );
  assert.match(warnings[0]!, /2023-12-31 er i LVL, ikke EUR/);
});

test("nøgletalsmotoren regner på de lettiske tal", () => {
  const rows = parseStatementRows(fixture("lv-statements-40203050078.json")).slice(0, 3);
  const { statements } = parseLatvianStatements(
    rows,
    fixture("lv-balance-40203050078.json"),
    fixture("lv-income-40203050078.json"),
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
    { currency: "EUR", registryCountry: "LV" },
  );
  const metric = (key: string) => report.metrics.find((item) => item.key === key)!;
  assert.equal(metric("revenue").latest?.value, 85252452);
  assert.equal(metric("revenue_growth").latest?.status, "ok");
  assert.equal(metric("equity_ratio").latest?.status, "ok");
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
    return new Response(JSON.stringify({ success: true, result: handler(url) }), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("adapteren: lookup, søgning og regnskaber mod data.gov.lv (fixtures)", async () => {
  const resources: Record<string, string> = {
    "25e80bf3-f107-4ab4-89ef-251b5b9374e9": "lv-register-40203050078.json",
    "27fcc5ec-c63b-4bfd-bb08-01f073a52d04": "lv-statements-40203050078.json",
    "50ef4f26-f410-4007-b296-22043ca3dc43": "lv-balance-40203050078.json",
    "d5fd17ef-d32e-40cb-8399-82b780095af0": "lv-income-40203050078.json",
  };
  await withFetch(
    (url) => fixture(resources[url.searchParams.get("resource_id") ?? ""]!),
    async (calls) => {
      const found = await latviaRegistry.lookupByNumber("LV40203050078");
      assert.equal(found?.name, 'AS "Printful Latvia"');
      assert.equal(calls[0]!.searchParams.get("filters"), '{"regcode":40203050078}');
      const searched = await latviaRegistry.searchByName("Printful Latvia");
      assert.equal(searched.length, 1);
      assert.equal(calls[1]!.searchParams.get("q"), '{"name":"Printful & Latvia:*"}');
      // Et personnummer slås aldrig op.
      const before = calls.length;
      assert.equal(await latviaRegistry.lookupByNumber("01019012345"), null);
      assert.equal(calls.length, before);

      const result = await latviaRegistry.fetchStatements("40203050078");
      assert.equal(result.statements.length, 6);
      const balanceCall = calls.find((url) =>
        url.searchParams.get("resource_id")?.startsWith("50ef"),
      );
      assert.equal(
        balanceCall?.searchParams.get("filters"),
        '{"statement_id":[2350165,2084312,1939124,1762199,1359384,1222072]}',
      );
    },
  );
});

test("adapteren: selskab uden regnskaber giver en tom liste; en fejl fra data.gov.lv kastes", async () => {
  await withFetch(
    () => ({ records: [] }),
    async () => {
      assert.deepEqual((await latviaRegistry.fetchStatements("40203050078")).statements, []);
    },
  );
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("nede", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(latviaRegistry.fetchStatements("40203050078"), /status 503/);
  } finally {
    globalThis.fetch = original;
  }
});
