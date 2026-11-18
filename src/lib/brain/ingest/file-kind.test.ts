import assert from "node:assert/strict";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";
import { detectFileKind, extensionOf, MAX_UPLOAD_BYTES, safeFileName } from "./file-kind.ts";
import { docxFixture, pdfFixture, xlsxFixture } from "./fixtures.ts";

const text = (value: string) => strToU8(value);

test("each supported type is recognised from its bytes", async () => {
  const pdf = detectFileKind(await pdfFixture([["Hej"]]), "Rapport.pdf");
  assert.deepEqual(pdf.ok && pdf.kind, "pdf");
  const docx = detectFileKind(docxFixture([{ p: "Hej" }]), "Notat.docx");
  assert.deepEqual(docx.ok && docx.kind, "docx");
  const xlsx = detectFileKind(await xlsxFixture({ Ark1: [["a"], ["b"]] }), "Tal.xlsx");
  assert.deepEqual(xlsx.ok && xlsx.kind, "xlsx");
  assert.deepEqual(detectFileKind(text("a,b\n1,2\n"), "beslutninger.csv"), {
    ok: true,
    kind: "csv",
    mime: "text/csv",
  });
  assert.deepEqual(detectFileKind(text("Fri tekst"), "notat.txt").ok, true);
  assert.deepEqual(detectFileKind(text("# Overskrift"), "notat.md").ok, true);
});

test("a renamed program is refused whatever its name says (acceptance of BR-1-8)", () => {
  const windows = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0, 0, 0, 4, 0, 0, 0]);
  for (const name of ["rapport.pdf", "rapport.docx", "tal.xlsx", "tal.csv", "notat.txt"]) {
    const result = detectFileKind(windows, name);
    assert.equal(result.ok, false, name);
    assert.match(!result.ok ? result.reason : "", /program/);
  }
  const elf = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]);
  assert.equal(detectFileKind(elf, "x.pdf").ok, false);
  assert.equal(detectFileKind(text("#!/bin/sh\nrm -rf /\n"), "x.txt").ok, false);
});

test("an unsupported extension, an empty file and an oversized file are refused with a reason", async () => {
  const exe = detectFileKind(await pdfFixture([["Hej"]]), "rapport.exe");
  assert.equal(exe.ok, false);
  assert.match(!exe.ok ? exe.reason : "", /understøttes ikke/);
  assert.equal(detectFileKind(new Uint8Array(), "tom.pdf").ok, false);
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
  big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const result = detectFileKind(big, "stor.pdf");
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : "", /25 MB/);
});

test("the name must agree with the content", async () => {
  const pdf = await pdfFixture([["Hej"]]);
  assert.equal(detectFileKind(pdf, "rapport.docx").ok, false);
  assert.equal(detectFileKind(pdf, "rapport.csv").ok, false);
  assert.equal(detectFileKind(docxFixture([{ p: "Hej" }]), "notat.xlsx").ok, false);
  assert.equal(detectFileKind(text("a,b"), "rapport.pdf").ok, false);
});

test("a zip that is not a Word or Excel file, a broken zip and a zip bomb are refused", () => {
  const other = zipSync({ "hej.txt": text("hej") });
  assert.equal(detectFileKind(other, "arkiv.docx").ok, false);
  assert.equal(
    detectFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), "x.docx").ok,
    false,
  );
  const docx = docxFixture([{ p: "Hej" }]);
  const bomb = detectFileKind(docx, "x.docx", { maxUnzippedBytes: 100 });
  assert.equal(bomb.ok, false);
  assert.match(!bomb.ok ? bomb.reason : "", /urimelig/);
});

test("html, svg, images and binary data are not text sources", () => {
  assert.equal(detectFileKind(text("<!DOCTYPE html><html></html>"), "x.txt").ok, false);
  assert.equal(detectFileKind(text("<svg xmlns='x'></svg>"), "x.txt").ok, false);
  assert.equal(
    detectFileKind(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), "x.txt").ok,
    false,
  );
  assert.equal(detectFileKind(new Uint8Array([0x61, 0x00, 0x62, 0x00]), "x.txt").ok, false);
});

test("file names are cleaned for a Storage path", () => {
  assert.equal(extensionOf("Årsrapport 2025.PDF"), "pdf");
  assert.equal(extensionOf("ingen"), "");
  assert.equal(safeFileName("../../etc/passwd"), "passwd");
  assert.equal(safeFileName("C:\\Users\\x\\Årsrapport 2025.pdf"), "Årsrapport 2025.pdf");
  assert.equal(safeFileName("  ..hidden.pdf"), "hidden.pdf");
  assert.equal(safeFileName("a\u0000b?.pdf"), "ab_.pdf");
  assert.equal(safeFileName(""), "fil");
  assert.ok(safeFileName("x".repeat(500) + ".pdf").length <= 120);
});
