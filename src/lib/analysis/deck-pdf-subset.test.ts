/** Test af udtræk af deck-sider til OCR. Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { originalPage, pdfSubset } from "./deck-pdf-subset.ts";

/** Et deck, hvor hver side har sin egen bredde, så rækkefølgen kan kontrolleres. */
async function deck(pageCount: number) {
  const doc = await PDFDocument.create();
  for (let page = 1; page <= pageCount; page += 1) doc.addPage([100 + page, 200]);
  return doc.save();
}

test("only the requested pages are copied, in the requested order", async () => {
  const result = await pdfSubset(await deck(40), [7, 3, 31], 40);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const subset = await PDFDocument.load(result.bytes);
  assert.equal(subset.getPageCount(), 3);
  assert.deepEqual(
    subset.getPages().map((page) => page.getWidth()),
    [107, 103, 131],
  );
  assert.ok(result.bytes.byteLength < (await deck(40)).byteLength);
});

test("subset page numbers map back to the deck in code", () => {
  assert.equal(originalPage([7, 3, 31], 1), 7);
  assert.equal(originalPage([7, 3, 31], 3), 31);
  assert.equal(originalPage([7, 3, 31], 4), null);
  assert.equal(originalPage([7, 3, 31], 0), null);
});

test("pages outside the deck and unreadable files are refused, not guessed", async () => {
  assert.equal((await pdfSubset(await deck(5), [6], 5)).ok, false);
  const broken = await pdfSubset(new TextEncoder().encode("not a pdf"), [1], 1);
  assert.equal(broken.ok, false);
});

test("a page count that differs from the extraction is refused (numbers could be shifted)", async () => {
  // Udtrækket (pdf.js) talte 6 sider, pdf-lib ser 5: siderne kunne være forskudt.
  assert.equal((await pdfSubset(await deck(5), [3], 6)).ok, false);
  // En side uden /Type tælles ikke af pdf-lib; det skal også afvises.
  const doc = await PDFDocument.load(await deck(6));
  doc.getPage(1).node.delete(PDFName.of("Type"));
  const shifted = await PDFDocument.load(await doc.save());
  const count = shifted.getPageCount();
  if (count !== 6) {
    assert.equal((await pdfSubset(await shifted.save(), [3, 5], 6)).ok, false);
  }
});

test("link annotations are dropped, other annotations (e.g. added text) are kept", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([100, 100]);
  const page = doc.addPage([200, 100]);
  const link = doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0, 0, 10, 10] });
  const note = doc.context.obj({
    Type: "Annot",
    Subtype: "FreeText",
    Rect: [0, 0, 50, 20],
    Contents: "ARR 2 mio.",
  });
  page.node.set(
    PDFName.of("Annots"),
    doc.context.obj([doc.context.register(link), doc.context.register(note)]),
  );
  const result = await pdfSubset(await doc.save(), [2], 2);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const subset = await PDFDocument.load(result.bytes);
  const annots = subset.getPage(0).node.lookup(PDFName.of("Annots"));
  assert.ok(annots instanceof PDFArray);
  const subtypes = annots
    .asArray()
    .map((ref) => subset.context.lookup(ref))
    .map((annot) => (annot instanceof PDFDict ? String(annot.get(PDFName.of("Subtype"))) : ""));
  assert.deepEqual(subtypes, ["/FreeText"]);
});
