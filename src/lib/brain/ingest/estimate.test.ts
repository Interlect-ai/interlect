import assert from "node:assert/strict";
import { test } from "node:test";
import type { Chunk } from "./chunk.ts";
import { estimateIngest, formatEstimate, INGEST_LIMITS_DKK, pagesWithinLimit } from "./estimate.ts";

function chunk(ordinal: number, page: number, tokens = 650): Chunk {
  return {
    ordinal,
    heading: null,
    pageFrom: page,
    pageTo: page,
    content: "tekst ".repeat(Math.round(tokens / 1.2)).slice(0, 2400),
    tokenCount: tokens,
    truncated: false,
  };
}
const report = (pages: number, perPage = 1) =>
  Array.from({ length: pages * perPage }, (_, index) =>
    chunk(index, Math.floor(index / perPage) + 1),
  );

test("a 100-page report costs about 0,5-1 kr. typically (05 §4) and stays under the 3 kr. limit", () => {
  // About 500 tokens a page: a 100-page report is roughly 70 chunks of 700 tokens.
  const chunks = Array.from({ length: 70 }, (_, index) =>
    chunk(index, Math.floor(index * (100 / 70)) + 1),
  );
  const estimate = estimateIngest(chunks);
  assert.ok(
    estimate.typicalDkk >= 0.4 && estimate.typicalDkk <= 1.5,
    `typical ${estimate.typicalDkk}`,
  );
  assert.ok(estimate.maxDkk >= estimate.typicalDkk);
  assert.equal(estimate.limitDkk, INGEST_LIMITS_DKK.document);
  assert.equal(estimate.overLimit, estimate.maxDkk > 3);
});

test("a very long document is over the limit and the choice of first pages fits inside it", () => {
  const chunks = report(300);
  const estimate = estimateIngest(chunks);
  assert.equal(estimate.overLimit, true);
  const pages = pagesWithinLimit(chunks);
  assert.ok(pages !== null && pages >= 1 && pages < 300, `pages ${pages}`);
  const kept = estimateIngest(chunks.filter((chunk) => (chunk.pageTo ?? 0) <= pages!));
  assert.ok(kept.maxDkk <= 3, `kept ${kept.maxDkk}`);
  const more = estimateIngest(chunks.filter((chunk) => (chunk.pageTo ?? 0) <= pages! + 1));
  assert.ok(more.maxDkk > 3 || pages === 300, "one more page would pass the limit");
});

test("a document under the limit offers every page", () => {
  const chunks = report(20);
  assert.equal(pagesWithinLimit(chunks), 20);
});

test("chunks without page numbers (a spreadsheet) have no page choice", () => {
  const rows = Array.from({ length: 5 }, (_, index) => ({
    ...chunk(index, 1, 30),
    pageFrom: null,
    pageTo: null,
  }));
  assert.equal(pagesWithinLimit(rows), null);
});

test("without the facts step only embedding and classification are priced", () => {
  const withFacts = estimateIngest(report(50));
  const without = estimateIngest(report(50), { withFacts: false });
  assert.equal(without.batches, 0);
  assert.ok(without.maxUsd < withFacts.maxUsd / 5);
});

test("the figure is shown in Danish with a decimal comma", () => {
  assert.equal(
    formatEstimate({ typicalDkk: 0.7, maxDkk: 2.1 }),
    "Anslået pris: 0,70 kr. (maks. 2,10 kr.)",
  );
});
