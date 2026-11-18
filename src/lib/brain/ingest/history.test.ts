import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  buildHistory,
  matchReasonCodes,
  normalizeCvr,
  normalizeDomain,
  parseAmountDkk,
  parseDecision,
  parseHistoryDate,
  suggestMapping,
  validMapping,
  type HistoryMapping,
  portfolioRows,
  rowHash,
} from "./history.ts";
import { readRawTable } from "./table.ts";

const CODES = [
  { code: "too_early", label: "For tidligt" },
  { code: "weak_team", label: "Svagt team" },
];

test("headers in Danish and English are mapped, each column once, and nothing is guessed", () => {
  const m = suggestMapping(["Selskab", "Domæne", "CVR", "Dato", "Beslutning", "Årsag", "Beløb"]);
  assert.deepEqual(m, {
    company: 0,
    domain: 1,
    cvr: 2,
    date: 3,
    decision: 4,
    reason: 5,
    amount: 6,
  });
  const e = suggestMapping(["Company", "Website", "Decision", "Reason"]);
  assert.equal(e.company, 0);
  assert.equal(e.domain, 1);
  assert.equal(e.decision, 2);
  assert.equal(e.reason, 3);
  assert.equal(e.date, null);
  assert.equal(suggestMapping(["A", "B"]).company, null);
  const tricky = suggestMapping([
    "Selskab",
    "Beslutningsdato",
    "Investeringsbeslutning",
    "Kommentar",
  ]);
  assert.deepEqual([tricky.date, tricky.decision, tricky.reason], [1, 2, 3]);
});

test("a mapping needs company and decision, existing columns and no column twice", () => {
  const base: HistoryMapping = {
    company: 0,
    domain: null,
    cvr: null,
    date: null,
    decision: 1,
    reason: null,
    amount: null,
  };
  assert.equal(validMapping(base, 2), null);
  assert.ok(validMapping({ ...base, company: null }, 2));
  assert.ok(validMapping({ ...base, decision: null }, 2));
  assert.ok(validMapping({ ...base, reason: 5 }, 2));
  assert.ok(validMapping({ ...base, reason: 0 }, 2));
});

test("decision words: committee rejections, investments, holds, rejections and unknowns", () => {
  const cases: Array<[string, ReturnType<typeof parseDecision>]> = [
    ["Investeret", "invest"],
    ["Invested", "invest"],
    ["Kasseret", "reject"],
    ["Afvist", "reject"],
    ["Pass", "reject"],
    ["Nej i komité", "decline_ic"],
    ["Declined by IC", "decline_ic"],
    ["På hold", "hold"],
    ["Parkeret", "hold"],
    ["Ikke investeret", "reject"],
    ["Closed lost", "reject"],
    ["Måske", null],
    ["Følger ikke", "reject"],
    ["Passiv", null],
    ["", null],
  ];
  for (const [text, kind] of cases) assert.equal(parseDecision(text), kind, text);
});

test("dates: ISO, Danish formats and month names; impossible or unknown dates are null", () => {
  assert.equal(parseHistoryDate("2025-03-07"), "2025-03-07");
  assert.equal(parseHistoryDate("7-3-2025"), "2025-03-07");
  assert.equal(parseHistoryDate("07/03/2025"), "2025-03-07");
  assert.equal(parseHistoryDate("7.3.2025"), "2025-03-07");
  assert.equal(parseHistoryDate("7. marts 2025"), "2025-03-07");
  assert.equal(parseHistoryDate("12 Oct 2024"), "2024-10-12");
  assert.equal(parseHistoryDate("31-02-2025"), null);
  assert.equal(parseHistoryDate("sidste år"), null);
  assert.equal(parseHistoryDate("2025"), null);
  assert.equal(parseHistoryDate("45000"), "2023-03-15", "an Excel serial number");
});

test("CVR, domain and amount", () => {
  assert.equal(normalizeCvr("DK 12 34 56 78"), "12345678");
  assert.equal(normalizeCvr("1234"), null);
  assert.equal(normalizeDomain("https://www.Nordlys.dk/om-os"), "nordlys.dk");
  assert.equal(normalizeDomain("nordlys"), null);
  assert.equal(parseAmountDkk("1.500.000,50 kr"), 1500000.5);
  assert.equal(parseAmountDkk("1,500,000"), 1500000);
  assert.equal(parseAmountDkk("2.5"), 2.5);
  assert.equal(parseAmountDkk("ukendt"), null);
});

test("a reason is matched to a code only when it names the code or label exactly", () => {
  assert.deepEqual(matchReasonCodes("For tidligt; Svagt team", CODES), ["too_early", "weak_team"]);
  assert.deepEqual(matchReasonCodes("too_early og weak_team", CODES), ["too_early", "weak_team"]);
  assert.deepEqual(matchReasonCodes("lidt for sent", CODES), []);
});

const mapping: HistoryMapping = {
  company: 0,
  domain: 1,
  cvr: 2,
  date: 3,
  decision: 4,
  reason: 5,
  amount: 6,
};

test("rows become decisions with deterministic keys; unusable rows are reported by row number", () => {
  const table = [
    ["Nordlys ApS", "nordlys.dk", "", "7-3-2025", "Kasseret", "For tidligt", ""],
    ["Havbrug A/S", "", "12345678", "2025-04-01", "Investeret", "Stærkt team", "2.000.000"],
    ["Uden navn", "", "", "2025-01-01", "Kasseret", "", ""].map((c, i) => (i === 0 ? "" : c)),
    ["Ukendt Beslutning", "", "", "2025-01-01", "Måske", "", ""],
    ["Dårlig Dato", "", "", "i går", "Afvist", "", ""],
    ["Nordlys ApS", "nordlys.dk", "", "7-3-2025", "Kasseret", "For tidligt", ""],
    ["", "", "", "", "", "", ""],
  ];
  const result = buildHistory(table, mapping, CODES);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0]!.entityKey, "domain:nordlys.dk");
  assert.equal(result.rows[0]!.decidedOn, "2025-03-07");
  assert.deepEqual(result.rows[0]!.reasonCodes, ["too_early"]);
  assert.equal(result.rows[1]!.entityKey, "cvr:12345678");
  assert.equal(result.rows[1]!.amountDkk, 2000000);
  assert.deepEqual(
    result.problems.map((p) => p.row),
    [4, 5, 6, 7],
    "row numbers count the header as row 1; the repeated row is reported, the empty row is not",
  );
  assert.deepEqual(result.unmatchedReasons, [{ text: "stærkt team", count: 1 }]);
});

test("a confirmed reason mapping is used, and an unknown code in it is dropped", () => {
  const table = [["Nordlys", "", "", "", "Kasseret", "Lidt for sent", ""]];
  const result = buildHistory(table, mapping, CODES, {
    "lidt for sent": ["too_early", "nonsense"],
  });
  assert.deepEqual(result.rows[0]!.reasonCodes, ["too_early"]);
  assert.equal(result.unmatchedReasons.length, 0);
});

test("the same row gets the same hash every time, a different one when anything differs", () => {
  const a = buildHistory(
    [["Nordlys ApS", "", "", "7-3-2025", "Kasseret", "x", ""]],
    mapping,
    CODES,
  );
  const b = buildHistory(
    [["nordlys aps", "", "", "2025-03-07", "afvist", "X", ""]],
    mapping,
    CODES,
  );
  const c = buildHistory(
    [["Nordlys ApS", "", "", "8-3-2025", "Kasseret", "x", ""]],
    mapping,
    CODES,
  );
  assert.equal(a.rows[0]!.rowHash, b.rows[0]!.rowHash);
  assert.notEqual(a.rows[0]!.rowHash, c.rows[0]!.rowHash);
});

test("a CSV and an Excel file give the same table", async () => {
  const csv = "Selskab;Beslutning\nNordlys;Kasseret\n";
  const comma = "Selskab,Beslutning\nNordlys,Kasseret\n";
  const fromComma = await readRawTable(new TextEncoder().encode(comma), "csv");
  assert.deepEqual(fromComma.headers, ["Selskab", "Beslutning"]);
  assert.deepEqual(fromComma.rows, [["Nordlys", "Kasseret"]]);
  const semi = await readRawTable(new TextEncoder().encode(csv), "csv");
  assert.equal(semi.rows[0]![0], "Nordlys");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Beslutninger");
  sheet.addRow(["Selskab", "Dato", "Beslutning"]);
  sheet.addRow(["Nordlys", new Date(Date.UTC(2025, 2, 7)), "Kasseret"]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  const xlsx = await readRawTable(bytes, "xlsx");
  assert.deepEqual(xlsx.rows, [["Nordlys", "2025-03-07", "Kasseret"]]);
  assert.equal(xlsx.sheet, "Beslutninger");
});

test("50 rows give 50 decisions and nothing else (acceptance: no cases, no jobs)", () => {
  const table = Array.from({ length: 50 }, (_, i) => [
    `Selskab ${i}`,
    "",
    "",
    "2025-01-01",
    i % 2 ? "Kasseret" : "Investeret",
    "",
    "",
  ]);
  const result = buildHistory(table, mapping, CODES);
  assert.equal(result.rows.length, 50);
  assert.equal(result.problems.length, 0);
});

test("confirmed portfolio companies from the website become 'invest' rows keyed on the domain (BR-1-9)", () => {
  const rows = portfolioRows([
    { name: "Acme", domain: "www.acme.io" },
    { name: "Acme", domain: "acme.dk" },
    { name: "  ", domain: "blank.io" },
    { name: "Ingen", domain: "ikke et domæne" },
  ]);
  assert.deepEqual(
    rows.map((r) => [r.companyName, r.companyDomain, r.entityKey, r.movementKind, r.decidedOn]),
    [
      ["Acme", "acme.io", "domain:acme.io", "invest", null],
      ["Acme", "acme.dk", "domain:acme.dk", "invest", null],
    ],
  );
  // Same name, two domains: two rows; the same company again: the same hash (no duplicate).
  assert.notEqual(rows[0]!.rowHash, rows[1]!.rowHash);
  assert.equal(portfolioRows([{ name: "Acme", domain: "acme.io" }])[0]!.rowHash, rows[0]!.rowHash);
  // The reason says "teamets", but the hash is the one rows confirmed before got.
  assert.equal(rows[0]!.reasonText, "Porteføljeselskab ifølge teamets hjemmeside (acme.io).");
  assert.equal(
    rows[0]!.rowHash,
    rowHash({
      companyName: "Acme",
      decidedOn: null,
      movementKind: "invest",
      reasonText: "Porteføljeselskab ifølge fondens hjemmeside (acme.io).",
    }),
  );
});
