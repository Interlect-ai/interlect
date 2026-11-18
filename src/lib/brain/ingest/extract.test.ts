import assert from "node:assert/strict";
import { test } from "node:test";
import { BrainUserError } from "../errors.ts";
import {
  decodeText,
  extractDocument,
  pageToBlocks,
  stripRepeatedHeadersFooters,
} from "./extract.ts";
import { MAX_TABLE_ROWS } from "./file-kind.ts";
import { docxFixture, pdfFixture, xlsxFixture } from "./fixtures.ts";

const longLine = (index: number) =>
  `Selskabet rapporterede i kvartal ${index} en omsætning på ${index + 3} mio. kr. og en bruttomargin på 71 procent.`;

test("a PDF is read page by page, with page numbers and without running headers and footers", async () => {
  const pages = Array.from({ length: 5 }, (_, index) => [
    `Resultat ${index + 1}`,
    longLine(index),
    longLine(index + 10),
    longLine(index + 20),
  ]);
  const bytes = await pdfFixture(pages, {
    header: "LP-brev Q2 2026 · Fortroligt",
    footer: "Side 1 af 5",
  });
  const doc = await extractDocument(bytes, "pdf");
  assert.equal(doc.kind, "pdf");
  assert.equal(doc.pageCount, 5);
  const all = doc.blocks.map((block) => block.text).join("\n");
  assert.ok(!all.includes("Fortroligt"), "the running header is removed");
  assert.ok(!/Side \d af/.test(all), "the page number footer is removed");
  assert.ok(all.includes("omsætning på 3 mio. kr."));
  assert.deepEqual([...new Set(doc.blocks.map((block) => block.page))], [1, 2, 3, 4, 5]);
  assert.ok(doc.blocks.some((block) => block.kind === "heading" && block.text === "Resultat 1"));
});

test("pages that are only images are counted and reported as partly read", async () => {
  const bytes = await pdfFixture([
    [longLine(1), longLine(2), longLine(3)],
    ["Kort"],
    [longLine(4), longLine(5), longLine(6)],
  ]);
  const doc = await extractDocument(bytes, "pdf");
  assert.deepEqual(doc.imagePages, [2]);
  assert.match(doc.warnings.join(" "), /delvist læst/);
});

test("a PDF with no text at all is refused with a clear reason", async () => {
  const bytes = await pdfFixture([[], []]);
  await assert.rejects(
    () => extractDocument(bytes, "pdf"),
    (error: unknown) => {
      assert.ok(error instanceof BrainUserError);
      assert.match(error.message, /ingen tekst/);
      return true;
    },
  );
});

test("a damaged or wrong file is a user error, not a crash", async () => {
  await assert.rejects(
    () => extractDocument(new TextEncoder().encode("%PDF-1.4 ikke en rigtig pdf"), "pdf"),
    BrainUserError,
  );
  await assert.rejects(
    () => extractDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]), "docx"),
    BrainUserError,
  );
  await assert.rejects(
    () => extractDocument(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]), "xlsx"),
    BrainUserError,
  );
});

test("a PDF over the page limit needs a page choice; with one only the first pages are read", async () => {
  const pages = Array.from({ length: 301 }, (_, index) => [
    longLine(index),
    longLine(index + 1),
    longLine(index + 2),
  ]);
  const bytes = await pdfFixture(pages);
  await assert.rejects(
    () => extractDocument(bytes, "pdf"),
    (error: unknown) => {
      assert.ok(error instanceof BrainUserError);
      assert.match(error.message, /301 sider/);
      return true;
    },
  );
  const partial = await extractDocument(bytes, "pdf", { maxPages: 3 });
  assert.equal(partial.pageCount, 3);
  assert.match(partial.warnings.join(" "), /første 3 af 301/);
});

test("repeated headers and footers are only removed when most pages repeat them", () => {
  const pages = [
    ["Fortroligt", "A", "Side 1"],
    ["Fortroligt", "B", "Side 2"],
    ["Fortroligt", "C", "Side 3"],
    ["C", "D", "Side 4"],
    ["Fortroligt", "E", "Side 5"],
  ];
  const cleaned = stripRepeatedHeadersFooters(pages);
  assert.deepEqual(
    cleaned.map((lines) => lines.join(",")),
    ["A", "B", "C", "C,D", "E"],
  );
  // Fewer than four pages: nothing repeats enough to be a header.
  assert.deepEqual(
    stripRepeatedHeadersFooters([
      ["Fortroligt", "A"],
      ["Fortroligt", "B"],
    ]),
    [
      ["Fortroligt", "A"],
      ["Fortroligt", "B"],
    ],
  );
});

test("a short title-like line is a heading and sentences stay together as a paragraph", () => {
  const blocks = pageToBlocks(
    [
      "1.2 Markedet",
      "Markedet vokser med 12 procent om året.",
      "Det drives af regulering.",
      "",
      "Næste afsnit står alene.",
    ],
    4,
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["heading", "paragraph", "paragraph"],
  );
  assert.equal(
    blocks[1]?.text,
    "Markedet vokser med 12 procent om året. Det drives af regulering.",
  );
  assert.ok(blocks.every((block) => block.page === 4));
});

test("Word: headings, paragraphs and tables keep their structure", async () => {
  const doc = await extractDocument(
    docxFixture([
      { h1: "Statusrapport Q2" },
      { p: "Selskabet har 12 ansatte og 40 betalende kunder." },
      { h2: "Økonomi" },
      {
        table: [
          ["Måned", "Omsætning"],
          ["April", "1,2 mio."],
          ["Maj", "1,4 mio."],
        ],
      },
    ]),
    "docx",
  );
  assert.deepEqual(
    doc.blocks.map((block) => `${block.kind}${block.level ?? ""}`),
    ["heading1", "paragraph", "heading2", "table"],
  );
  assert.equal(doc.blocks[3]?.text, "Måned | Omsætning\nApril | 1,2 mio.\nMaj | 1,4 mio.");
});

test("Excel: one row per block with column names, per visible sheet", async () => {
  const doc = await extractDocument(
    await xlsxFixture({
      Beslutninger: [
        ["Selskab", "Beslutning", "Årsag"],
        ["Pleo", "Investeret", "Stærkt team"],
        [null, null, null],
        ["Zeta", "Kasseret", null],
      ],
      Tom: [[null]],
    }),
    "xlsx",
  );
  assert.equal(doc.rowCount, 2);
  assert.deepEqual(
    doc.blocks.map((block) => block.text),
    [
      "Ark: Beslutninger · Selskab: Pleo · Beslutning: Investeret · Årsag: Stærkt team",
      "Ark: Beslutninger · Selskab: Zeta · Beslutning: Kasseret",
    ],
  );
});

test("Excel over 10.000 rows is refused", async () => {
  const rows: Array<Array<string | number>> = [["Selskab", "Tal"]];
  for (let index = 0; index <= MAX_TABLE_ROWS; index += 1) rows.push([`S${index}`, index]);
  await assert.rejects(async () => extractDocument(await bytesFor(rows), "xlsx"), BrainUserError);
});

async function bytesFor(rows: Array<Array<string | number>>) {
  return xlsxFixture({ Ark1: rows });
}

test("CSV: semicolons, a BOM and Windows-1252 Danish letters are read right", async () => {
  const utf8 = new TextEncoder().encode(
    "﻿Selskab;Beslutning\nPleo;Investeret\n;\nÆgte A/S;Kasseret\n",
  );
  const doc = await extractDocument(utf8, "csv");
  assert.deepEqual(
    doc.blocks.map((block) => block.text),
    ["Selskab: Pleo · Beslutning: Investeret", "Selskab: Ægte A/S · Beslutning: Kasseret"],
  );
  // "Ægte, Øl & Åben" in Windows-1252: Æ = 0xC6, Ø = 0xD8, Å = 0xC5.
  const latin = new Uint8Array([
    ...Buffer.from("Selskab,Navn\n", "latin1"),
    0xc6,
    0x2c,
    0xd8,
    0x6c,
    0x0a,
    0xc5,
    0x2c,
    0x78,
  ]);
  assert.match(decodeText(latin), /Æ,Øl\nÅ,x/);
});

test("CSV over 10.000 rows or with no rows is refused", async () => {
  const lines = ["Selskab,Tal"];
  for (let index = 0; index <= MAX_TABLE_ROWS; index += 1) lines.push(`S${index},${index}`);
  await assert.rejects(
    () => extractDocument(new TextEncoder().encode(lines.join("\n")), "csv"),
    BrainUserError,
  );
  await assert.rejects(
    () => extractDocument(new TextEncoder().encode("   \n\n"), "csv"),
    BrainUserError,
  );
});

test("plain text: markdown headings and paragraphs", async () => {
  const doc = await extractDocument(
    new TextEncoder().encode("# Mødenotat\n\nVi talte om\nrunway og hiring.\n\n\nNæste punkt."),
    "text",
  );
  assert.deepEqual(
    doc.blocks.map((block) => `${block.kind}:${block.text}`),
    [
      "heading:# Mødenotat".replace("# ", ""),
      "paragraph:Vi talte om runway og hiring.",
      "paragraph:Næste punkt.",
    ],
  );
  await assert.rejects(
    () => extractDocument(new TextEncoder().encode("  \n "), "text"),
    BrainUserError,
  );
});

test("Excel: hidden sheets and formulas without a saved result are reported, not read silently", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const visible = workbook.addWorksheet("Tal");
  visible.addRow(["Navn", "Sum"]);
  visible.addRow(["Pleo", { formula: "1+1" } as never]);
  visible.addRow(["Zeta", 3]);
  workbook.addWorksheet("Skjult", { state: "hidden" }).addRow(["Hemmeligt"]);
  const doc = await extractDocument(new Uint8Array(await workbook.xlsx.writeBuffer()), "xlsx");
  assert.deepEqual(
    doc.blocks.map((block) => block.text),
    ["Ark: Tal · Navn: Pleo", "Ark: Tal · Navn: Zeta · Sum: 3"],
  );
  assert.match(doc.warnings.join(" "), /Skjulte ark er ikke læst: Skjult/);
  assert.match(doc.warnings.join(" "), /1 formler uden gemt resultat/);
});

test("CSV with an unterminated quote is refused instead of merging rows, and UTF-16 text is decoded", async () => {
  await assert.rejects(
    () =>
      extractDocument(
        new TextEncoder().encode('Selskab,Note\nPleo,"en note der aldrig slutter\nZeta,ok\n'),
        "csv",
      ),
    (error: unknown) => error instanceof BrainUserError && /citationstegn/.test(error.message),
  );
  const utf16 = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("Selskab,Beslutning\nÆgte,Investeret\n", "utf16le"),
  ]);
  const doc = await extractDocument(new Uint8Array(utf16), "csv");
  assert.equal(doc.blocks[0]?.text, "Selskab: Ægte · Beslutning: Investeret");
});
