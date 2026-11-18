/**
 * Litauen-adapteren på rigtige svar fra get.data.gov.lt, gemt 8. okt 2026 (Registrų
 * centras' JAR, CC BY 4.0): Vinted, UAB (302767152, eget regnskab og koncernregnskab samme år)
 * og MB Service 4 U (305471557, en lille mažoji bendrija med de små skabeloners linje-id'er).
 * Kør: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeFinancialMetrics } from "../financial-metrics.ts";
import { chooseRegistryMatch, comparableRegistryName } from "./match.ts";
import {
  entityIdOf,
  findLithuanianCompanyCodes,
  isValidLithuanianCompanyCode,
  lithuaniaRegistry,
  nameWords,
  normalizeLithuanianCompanyCode,
  parseLithuanianCompany,
  parseLithuanianStatements,
  rankCompanies,
} from "./lithuania.ts";
import type { RegistryCompany, RegistryStatement } from "./types.ts";

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
}
const rows = (name: string) => fixture(name)["_data"] as Record<string, unknown>[];

const VINTED = "1bd6fe97-7e8e-4ea4-86be-14cbc81374b4";
const MB = "0e7f1f8a-ceb3-4c54-89b6-22b0279589ab";

function valueOf(statement: RegistryStatement | undefined, metric: string): number | undefined {
  return statement?.lineItems.find((item) => item.metric === metric)?.value;
}

test("selskabskoden: 9 cifre med kontrolciffer, aldrig en personkode", () => {
  assert.equal(isValidLithuanianCompanyCode("302767152"), true);
  assert.equal(isValidLithuanianCompanyCode("110000291"), true);
  assert.equal(isValidLithuanianCompanyCode("305959706"), true);
  // Forkert kontrolciffer, for kort, personkode (11 cifre).
  assert.equal(isValidLithuanianCompanyCode("302767153"), false);
  assert.equal(isValidLithuanianCompanyCode("30276715"), false);
  assert.equal(isValidLithuanianCompanyCode("38703181745"), false);
  assert.equal(normalizeLithuanianCompanyCode("302 767 152"), "302767152");
  assert.equal(normalizeLithuanianCompanyCode("LT100005828314"), null);
});

test("koden findes i et decks eller websites tekst, kun ved et kendt mærke", () => {
  assert.deepEqual(
    findLithuanianCompanyCodes("Vinted, UAB · Įmonės kodas 302767152 · PVM kodas LT100005828314"),
    ["302767152"],
  );
  assert.deepEqual(
    findLithuanianCompanyCodes("Company code: 302 767 152. Reg. No. 305959706. Įm. k. 302767152"),
    ["302767152", "305959706"],
  );
  assert.deepEqual(findLithuanianCompanyCodes("JURIDINIO ASMENS KODAS 305471557"), ["305471557"]);
  // Uden mærke, forkert kontrolciffer eller en del af et længere tal tæller ikke.
  assert.deepEqual(
    findLithuanianCompanyCodes("Ring 302767152 · Company code 302767153 · reg. no. 3027671529"),
    [],
  );
});

test("registret: aktivt selskab; slettet, likvideret og personligt hæftende er ikke med", () => {
  const record = rows("lt-entity-302767152.json")[0]!;
  const company = parseLithuanianCompany(record);
  assert.ok(company);
  assert.equal(company.country, "LT");
  assert.equal(company.registryNumber, "302767152");
  assert.equal(company.name, "Vinted, UAB");
  assert.equal(company.active, true);
  assert.equal(company.status, "aktiv");
  assert.equal(company.registryUrl, "https://www.registrucentras.lt/jar/p/dok.php?kod=302767152");
  assert.equal(entityIdOf(record), VINTED);

  const removed = rows("lt-search-vinted.json").find((row) => row["ja_kodas"] === 305305400);
  assert.equal(parseLithuanianCompany(removed)?.active, false);
  assert.equal(parseLithuanianCompany(removed)?.status, "slettet fra registret");
  const liquidated = { ...record, statusas: { kodas: 11, name: "Liquidated" } };
  assert.equal(parseLithuanianCompany(liquidated)?.status, "likvideret");
  const restructuring = { ...record, statusas: { kodas: 4, name: "Under Restructuring" } };
  assert.equal(parseLithuanianCompany(restructuring)?.active, true);
  assert.match(parseLithuanianCompany(restructuring)!.status, /Under Restructuring/);
  // Individuel virksomhed og interessentskab: navnet er anonymiseret, og de slås aldrig op.
  assert.equal(parseLithuanianCompany({ ...record, forma: { kodas: 810 } }), null);
  assert.equal(parseLithuanianCompany({ ...record, forma: { kodas: 210 } }), null);
  assert.equal(parseLithuanianCompany({ ...record, ja_kodas: 302767153 }), null);
});

test("navnet: selskabsformen fjernes kun for Litauen, foran eller bagved", () => {
  assert.equal(comparableRegistryName('UAB "Vinted"', "LT"), '"Vinted"');
  assert.equal(comparableRegistryName("Ignitis grupė, AB", "LT"), "Ignitis grupė");
  assert.equal(comparableRegistryName("Mažoji bendrija Kubas", "LT"), "Kubas");
  assert.equal(comparableRegistryName("Cosmospa, MB", "LT"), "Cosmospa");
  // En svensk "AB" og en dansk "MB" er uændrede uden for Litauen.
  assert.equal(comparableRegistryName("Spotify AB", "SE"), "Spotify AB");
});

test("søgeordene bygges kun af bogstaver og cifre, uden selskabsform", () => {
  assert.deepEqual(nameWords("Vinted, UAB"), ["vinted"]);
  assert.deepEqual(nameWords('UAB "Ignitis grupė"'), ["ignitis", "grupė"]);
  assert.deepEqual(nameWords('a") & drop(table'), ["a", "drop", "table"]);
  assert.deepEqual(nameWords("Uždaroji akcinė bendrovė"), []);
  assert.deepEqual(nameWords("X"), []);
});

test("søgningen: samme navn først, så aktive; registret vælger Vinted, UAB", () => {
  const companies = rows("lt-search-vinted.json")
    .map(parseLithuanianCompany)
    .filter((company): company is RegistryCompany => !!company);
  const ranked = rankCompanies(companies, "vinted");
  assert.equal(ranked[0]!.registryNumber, "302767152");
  const chosen = chooseRegistryMatch({
    candidates: ranked,
    context: { brandName: "Vinted" },
    websiteHost: "vinted.com",
  });
  assert.equal(chosen.match?.registryNumber, "302767152");
});

test("regnskaber: kun det eget regnskab, aldrig koncernens; dubletter tælles én gang", () => {
  const { statements, warnings } = parseLithuanianStatements(
    VINTED,
    fixture("lt-balance-302767152.json"),
    fixture("lt-income-302767152.json"),
  );
  // De ældre skabeloner (2017-2021) mangler passivlinjer, så kun deres gæld i alt udelades.
  assert.equal(warnings.length, 5);
  assert.ok(warnings.every((warning) => /gæld dækker ikke hele passivsiden/.test(warning)));
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    [
      "2024-12-31",
      "2023-12-31",
      "2022-12-31",
      "2021-12-31",
      "2020-12-31",
      "2019-12-31",
      "2018-12-31",
      "2017-12-31",
    ],
  );
  assert.ok(statements.every((statement) => statement.currency === "EUR"));
  const [y2024, y2023, y2022] = statements;
  assert.equal(valueOf(y2024, "revenue"), 739918000);
  assert.equal(valueOf(y2024, "result_before_tax"), 74786000);
  assert.equal(valueOf(y2024, "net_result"), 65667000);
  assert.equal(valueOf(y2024, "noncurrent_assets"), 210015000);
  assert.equal(valueOf(y2024, "current_assets"), 263536000);
  assert.equal(valueOf(y2024, "equity"), 178519000);
  assert.equal(valueOf(y2024, "liabilities"), 295032000);
  // Balancen går op hvert år: anlæg + omsætning = egenkapital + gæld.
  for (const statement of statements.filter((item) => item.periodEnd >= "2022-12-31")) {
    assert.equal(
      valueOf(statement, "noncurrent_assets")! + valueOf(statement, "current_assets")!,
      valueOf(statement, "equity")! + valueOf(statement, "liabilities")!,
      statement.periodEnd,
    );
  }
  // 2023 har både det eget (523,3 mio.) og koncernens (596,3 mio.) regnskab: kun det eget tæller.
  assert.equal(valueOf(y2023, "revenue"), 523335441);
  assert.equal(valueOf(y2023, "equity"), 98194546);
  assert.equal(valueOf(y2022, "net_result"), -28372053);
  assert.equal(y2024!.lineItems.length, 7);
  assert.equal(
    y2024!.lineItems.find((item) => item.metric === "revenue")?.tag,
    "data.gov.lt:ISLT00001",
  );
  assert.match(
    y2024!.sourceDocumentUrl,
    /juridinis_asmuo\._id=%221bd6fe97-[^&]+%22&laikotarpis_iki=%222024-12-31%22$/,
  );
});

test("regnskaber fra en lille mažoji bendrija (andre linje-id'er for gæld og resultat)", () => {
  const { statements, warnings } = parseLithuanianStatements(
    MB,
    fixture("lt-balance-305471557.json"),
    fixture("lt-income-305471557.json"),
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    statements.map((statement) => statement.periodEnd),
    ["2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31", "2020-12-31"],
  );
  const latest = statements[0];
  assert.equal(valueOf(latest, "revenue"), 20060);
  assert.equal(valueOf(latest, "result_before_tax"), 10861);
  assert.equal(valueOf(latest, "net_result"), 10318);
  assert.equal(valueOf(latest, "liabilities"), 9399);
  assert.equal(valueOf(latest, "equity"), 16061);
});

test("en rettelse erstatter den gamle indsendelse; uenige tal udelader posten; litas udelades", () => {
  const balance = rows("lt-balance-305471557.json");
  const income = rows("lt-income-305471557.json");
  // En rettet balance for 2024 senere end resultatopgørelsen: resultatet bliver stående.
  const corrected = balance
    .filter((row) => row["laikotarpis_iki"] === "2024-12-31")
    .map((row) => ({
      ...row,
      reg_date: "2025-09-01",
      reiksme: row["line_type_id"] === "BSLT00040" ? 17000 : row["reiksme"],
    }));
  // To forskellige tal for omsætningen i samme indsendelse (2023).
  const conflicting = {
    ...income.find(
      (row) => row["laikotarpis_iki"] === "2023-12-31" && row["line_type_id"] === "ISLT00345",
    )!,
    reiksme: 9999,
  };
  // Et regnskab fra før euroen.
  const litas = { ...balance[0]!, laikotarpis_nuo: "2014-01-01", laikotarpis_iki: "2014-12-31" };
  const { statements, warnings } = parseLithuanianStatements(
    MB,
    { _data: [...balance, ...corrected] },
    { _data: [...income, conflicting] },
  );
  assert.equal(valueOf(statements[0], "equity"), 17000);
  assert.equal(valueOf(statements[0], "revenue"), 20060);
  assert.equal(valueOf(statements[1], "revenue"), undefined);
  assert.equal(valueOf(statements[1], "net_result"), 400);
  assert.match(warnings.join(" "), /2023-12-31 har forskellige tal for "PARDAVIMO PAJAMOS"/);

  const old = parseLithuanianStatements(MB, { _data: [litas] }, { _data: [] });
  assert.deepEqual(old.statements, []);
  assert.match(old.warnings[0]!, /2014-12-31 er i litas/);
});

test("de ældre skabeloners leverandørgæld er kun gæld i alt, når balancen går op", () => {
  const before = (name: string, end: string) => ({
    _data: rows(name).filter((row) => String(row["laikotarpis_iki"]) <= end),
  });
  // Vinted 2019–2021 (FS0130): "mokėtinos sumos ir kiti įsipareigojimai" mangler fx 42,9 mio. €
  // periodeafgrænsning i 2021, så gæld i alt udelades i stedet for at blive for lav.
  const old = parseLithuanianStatements(
    VINTED,
    before("lt-balance-302767152.json", "2021-12-31"),
    before("lt-income-302767152.json", "2021-12-31"),
  );
  assert.deepEqual(
    old.statements.map((statement) => statement.periodEnd),
    [
      "2021-12-31",
      "2020-12-31",
      "2019-12-31",
      "2018-12-31",
      "2017-12-31",
      "2016-12-31",
      "2015-12-31",
    ],
  );
  for (const statement of old.statements.filter((item) => item.periodEnd >= "2019-12-31")) {
    assert.equal(valueOf(statement, "liabilities"), undefined, statement.periodEnd);
    assert.equal(valueOf(statement, "payables"), undefined, statement.periodEnd);
    assert.equal(valueOf(statement, "equity") !== undefined, true);
  }
  assert.equal(old.warnings.length, 6);
  assert.match(old.warnings[0]!, /2021-12-31: registrets gæld dækker ikke hele passivsiden/);
  // Vinted 2015 (FS0503): balancen går op med den, så den er gæld i alt.
  const balanced = parseLithuanianStatements(
    VINTED,
    before("lt-balance-302767152.json", "2015-12-31"),
    before("lt-income-302767152.json", "2015-12-31"),
  );
  assert.deepEqual(balanced.warnings, []);
  assert.equal(valueOf(balanced.statements[0], "liabilities"), 2017012);
  assert.equal(
    balanced.statements[0]!.lineItems.find((item) => item.metric === "liabilities")?.tag,
    "data.gov.lt:BSLT00055",
  );
});

test("nøgletalsmotoren regner på de litauiske tal", () => {
  const { statements } = parseLithuanianStatements(
    VINTED,
    fixture("lt-balance-302767152.json"),
    fixture("lt-income-302767152.json"),
  );
  const report = computeFinancialMetrics(
    statements.map((statement) => ({
      periodStart: statement.periodStart,
      periodEnd: statement.periodEnd,
      sourceDocumentUrl: statement.sourceDocumentUrl,
      reportingClassText: statement.reportingClassText,
      lineItems: statement.lineItems.map(({ metric, value }) => ({ metric, value })),
    })),
    "2026-10-08",
    { currency: "EUR", registryCountry: "LT" },
  );
  const metric = (key: string) => report.metrics.find((item) => item.key === key)!;
  assert.equal(metric("revenue").latest?.value, 739918000);
  assert.equal(metric("revenue_growth").latest?.status, "ok");
  assert.equal(metric("debt_to_equity").latest?.status, "ok");
  // Registret oplyser ikke aktiver i alt (periodeafgrænsningsposter mangler), så soliditeten
  // regnes ikke af anlæg + omsætning; den kan ikke beregnes.
  assert.notEqual(metric("equity_ratio").latest?.status, "ok");
});

/** Erstatter fetch med faste svar i ét test; kalder `run` og gendanner. */
async function withFetch<T>(
  handler: (url: string) => unknown,
  run: (calls: string[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    return new Response(JSON.stringify(handler(url)), { status: 200 });
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

test("adapteren: opslag, søgning og regnskaber mod get.data.gov.lt (fixtures)", async () => {
  await withFetch(
    (url) =>
      url.includes("/iregistruoti/")
        ? url.includes("ja_kodas=302767152")
          ? fixture("lt-entity-302767152.json")
          : fixture("lt-search-vinted.json")
        : url.includes("/balanso_ataskaitos/")
          ? fixture("lt-balance-302767152.json")
          : fixture("lt-income-302767152.json"),
    async (calls) => {
      const found = await lithuaniaRegistry.lookupByNumber("302 767 152");
      assert.equal(found?.name, "Vinted, UAB");
      assert.match(calls[0]!, /JuridinisAsmuo\?ja_kodas=302767152&select\(/);

      const searched = await lithuaniaRegistry.searchByName('UAB "Vinted"');
      assert.equal(searched[0]?.registryNumber, "302767152");
      assert.equal(
        decodeURIComponent(calls[1]!.split("?")[1]!.split("&")[0]!),
        'ja_pavadinimas.lower().contains("vinted")',
      );

      // En personkode eller et forkert kontrolciffer slås aldrig op.
      const before = calls.length;
      assert.equal(await lithuaniaRegistry.lookupByNumber("38703181745"), null);
      assert.equal(await lithuaniaRegistry.lookupByNumber("302767153"), null);
      assert.equal(calls.length, before);

      const result = await lithuaniaRegistry.fetchStatements("302767152");
      assert.equal(result.statements.length, 8);
      const balanceCall = calls.find((url) => url.includes("/balanso_ataskaitos/"))!;
      assert.match(
        balanceCall,
        new RegExp(`juridinis_asmuo\\._id=%22${VINTED}%22&sort\\(-laikotarpis_iki\\)`),
      );
    },
  );
});

test("søgningen vælger intet, når registret har flere svar, end vi henter", async () => {
  const one = rows("lt-search-vinted.json")[0]!;
  const many = Array.from({ length: 501 }, () => one);
  await withFetch(
    () => ({ _data: many }),
    async (calls) => {
      assert.deepEqual(await lithuaniaRegistry.searchByName("Vinted"), []);
      assert.match(calls[0]!, /limit\(501\)$/);
    },
  );
  await withFetch(
    () => ({ _data: many.slice(0, 500) }),
    async () => {
      assert.equal((await lithuaniaRegistry.searchByName("Vinted")).length, 10);
    },
  );
});

test("adapteren: ukendt kode eller personligt selskab giver ingen regnskaber; en fejl kastes", async () => {
  await withFetch(
    () => ({ _data: [] }),
    async (calls) => {
      assert.deepEqual(await lithuaniaRegistry.fetchStatements("302767152"), {
        statements: [],
        warnings: [],
      });
      assert.equal(calls.length, 1);
    },
  );
  const personal = { _data: [{ ...rows("lt-entity-302767152.json")[0]!, forma: { kodas: 810 } }] };
  await withFetch(
    () => personal,
    async (calls) => {
      assert.deepEqual((await lithuaniaRegistry.fetchStatements("302767152")).statements, []);
      assert.equal(calls.length, 1);
    },
  );
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("nede", { status: 503 });
  }) as typeof fetch;
  try {
    await assert.rejects(lithuaniaRegistry.fetchStatements("302767152"), /status 503/);
    // Ét nyt forsøg, så fejlen.
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("adapteren: en enkelt 500 fra registret prøves igen og går igennem", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response("<html>fejl</html>", { status: 500 })
      : new Response(JSON.stringify(fixture("lt-entity-302767152.json")), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await lithuaniaRegistry.lookupByNumber("302767152"))?.name, "Vinted, UAB");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
