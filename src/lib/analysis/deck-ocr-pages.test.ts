/** Test af udvælgelsen af deck-sider til tekstgenkendelse (B7). Kør: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DECK_OCR_STATED_BY,
  estimateDeckOcrUsd,
  recognisedPages,
  thinPages,
  usageCostUsd,
} from "./deck-ocr-pages.ts";

const long = "x".repeat(250);

test("tomme og tynde sider vælges, sider med tekst gør ikke", () => {
  const pages = thinPages({
    pageCount: 5,
    rows: [
      { slideRef: 1, excerpt: long, statedBy: "Virksomhedens pitch deck" },
      { slideRef: 2, excerpt: "Team", statedBy: "Virksomhedens pitch deck" },
      { slideRef: 4, excerpt: long, statedBy: "Virksomhedens pitch deck" },
    ],
  });
  assert.deepEqual(pages, [2, 3, 5]);
});

test("en side, der allerede er læst som billede, læses ikke igen", () => {
  const pages = thinPages({
    pageCount: 2,
    rows: [
      { slideRef: 1, excerpt: "Logo", statedBy: "Virksomhedens pitch deck" },
      { slideRef: 1, excerpt: "Kort tekst", statedBy: DECK_OCR_STATED_BY },
    ],
  });
  assert.deepEqual(pages, [2]);
});

test("højst 12 sider pr. kald", () => {
  assert.equal(thinPages({ pageCount: 40, rows: [] }).length, 12);
});

test("et typisk deck på 20 sider holder sig under loftet på $0,10", () => {
  const estimate = estimateDeckOcrUsd(20, 20);
  assert.ok(estimate.maxCostUsd < 0.1, String(estimate.maxCostUsd));
  assert.ok(estimateDeckOcrUsd(60, 20).maxCostUsd > 0.1);
});

test("sider, der allerede er forsøgt læst, sendes ikke igen", () => {
  assert.deepEqual(thinPages({ pageCount: 3, rows: [], attempted: [1, 3] }), [2]);
});

test("et sidenummer uden for decket afviser hele svaret", () => {
  const result = recognisedPages(
    [
      { page: 0, text: "Forside" },
      { page: 2, text: "Team" },
    ],
    [1, 2],
    5,
    6000,
  );
  assert.equal(result.ok, false);
});

test("ikke-ønskede, dublerede og tomme sider tælles som droppet", () => {
  const result = recognisedPages(
    [
      { page: 2, text: "Team" },
      { page: 2, text: "Team igen" },
      { page: 3, text: "   " },
      { page: 4, text: "Ikke bedt om" },
    ],
    [2, 3],
    5,
    6000,
  );
  assert.ok(result.ok);
  assert.deepEqual(result.ok && result.pages, [{ page: 2, text: "Team" }]);
  assert.equal(result.ok && result.dropped, 3);
});

test("pris ud fra tokenforbrug", () => {
  assert.equal(usageCostUsd(100_000, 1_000), 0.0795);
  assert.equal(usageCostUsd(null, 1_000), null);
});
